const { User, Role, sequelize } = require('../models');
const { Op, Sequelize, QueryTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const { AppError, logger, parseTrashedMode, trashedSequelizeOptions, withTrashedWhere, buildCreatedAtRange } = require('../../../../shared');

/** Admin list role filter values → roles.name (and users.role legacy column). */
const ROLE_FILTER_ALIASES = {
    student: ['user', 'student'],
    instructor: ['instructor'],
    admin: ['admin'],
};

const EXPORT_BATCH_SIZE = 1000;

const USER_EXPORT_CSV_HEADERS = [
    'email',
    'password',
    'name',
    'phone',
    'role',
    'status',
    'membership_plan_name',
    'membership_status',
    'plan_price',
    'payment_id',
    'plan_purchased',
    'plan_expiry',
    'designation',
    'profession',
    'company',
    'city',
    'state',
    'country',
    'bio',
    'gst',
];

function escapeCsvCell(value) {
    const s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function formatMembershipPlanLabel(membershipRow) {
    if (!membershipRow) return 'Free';
    if (membershipRow.plan_name) return String(membershipRow.plan_name);
    const slug = String(membershipRow.membership_type || '').trim();
    if (!slug) return 'Free';
    return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function membershipStatusFromRow(membershipRow) {
    if (!membershipRow) return 'Free';
    const now = new Date();
    const startsAt = membershipRow.starts_at ? new Date(membershipRow.starts_at) : null;
    const expiresAt = membershipRow.expires_at ? new Date(membershipRow.expires_at) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) return 'Free';
    if (expiresAt <= now) return 'Expired';
    if (startsAt && !Number.isNaN(startsAt.getTime()) && startsAt > now) return 'Pending';
    return 'Active';
}

function formatMembershipDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Purchase price from users.plan JSON ({ price } or { plan_price }) when admin/import stored it. */
function parsePlanJsonPrice(planValue) {
    if (planValue == null || planValue === '') return null;
    let parsed = planValue;
    if (typeof planValue === 'string') {
        const trimmed = planValue.trim();
        if (!trimmed.startsWith('{')) return null;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            return null;
        }
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const price = parsed.price ?? parsed.plan_price;
    if (price == null || String(price).trim() === '') return null;
    return String(price).trim();
}

function resolveMembershipPlanPrice(user, membership) {
    const fromJson = parsePlanJsonPrice(user.plan);
    if (fromJson) return fromJson;
    if (membership?.plan_price != null && String(membership.plan_price).trim() !== '') {
        return String(membership.plan_price).trim();
    }
    return '';
}

/**
 * Latest membership per user in one query (by highest user_memberships.id).
 * Maps rows back to internal users.id, including wp_user_id legacy rows.
 */
async function fetchLatestMembershipsByUserIds(userRows) {
    if (!userRows.length) return new Map();

    const lookupIds = [...new Set(
        userRows.flatMap((u) => {
            const ids = [];
            const uid = Number(u.id);
            if (Number.isFinite(uid) && uid > 0) ids.push(uid);
            const wpId = u.wp_user_id != null ? Number(u.wp_user_id) : null;
            if (Number.isFinite(wpId) && wpId > 0) ids.push(wpId);
            return ids;
        }),
    )];
    if (!lookupIds.length) return new Map();

    const membershipRows = await sequelize.query(
        `SELECT um.id, um.user_id, um.membership_type, um.order_id, um.starts_at, um.expires_at,
                pp.name AS plan_name, pp.price AS plan_price
         FROM user_memberships um
         LEFT JOIN premium_plans pp ON pp.slug = um.membership_type
         INNER JOIN (
           SELECT user_id, MAX(id) AS max_id
           FROM user_memberships
           WHERE user_id IN (:lookupIds)
           GROUP BY user_id
         ) latest ON latest.max_id = um.id`,
        {
            replacements: { lookupIds },
            type: QueryTypes.SELECT,
        },
    );

    const byMembershipUserId = new Map(
        membershipRows.map((row) => [Number(row.user_id), row]),
    );
    const result = new Map();
    for (const user of userRows) {
        const uid = Number(user.id);
        const wpId = user.wp_user_id != null ? Number(user.wp_user_id) : null;
        const membership = byMembershipUserId.get(uid) || (wpId ? byMembershipUserId.get(wpId) : null);
        if (membership) result.set(uid, membership);
    }
    return result;
}

function enrichUsersWithMembership(rows, membershipMap) {
    return rows.map((user) => {
        const membership = membershipMap.get(Number(user.id)) || null;
        const membership_plan_name = formatMembershipPlanLabel(membership);
        const membership_status = membershipStatusFromRow(membership);
        const membership_expires_at = membership?.expires_at ?? null;
        const membership_payment_id = membership?.order_id ?? null;
        const membership_plan_purchased = membership?.starts_at ?? null;
        const membership_plan_expiry = membership?.expires_at ?? null;
        const membership_plan_price = resolveMembershipPlanPrice(user, membership);
        return {
            ...user,
            membership_plan_name,
            membership_status,
            membership_expires_at,
            membership_payment_id,
            membership_plan_purchased,
            membership_plan_expiry,
            membership_plan_price,
            membership_name: membership ? membership_plan_name : null,
        };
    });
}

function userRowToExportCsvLine(user) {
    const cells = [
        user.email,
        '',
        user.name,
        user.phone,
        user.role,
        user.status,
        user.membership_plan_name ?? 'Free',
        user.membership_status ?? 'Free',
        user.membership_plan_price ?? '',
        user.membership_payment_id ?? '',
        formatMembershipDate(user.membership_plan_purchased),
        formatMembershipDate(user.membership_plan_expiry ?? user.membership_expires_at),
        user.designation,
        user.profession,
        user.company,
        user.city,
        user.state,
        user.country,
        user.bio,
        user.gst,
    ];
    return cells.map(escapeCsvCell).join(',');
}

async function buildListQueryContext(query = {}) {
    const {
        page = 1,
        limit = 10,
        search,
        role_id,
        role,
        status,
        membership,
        email,
        state,
        designation,
        profession,
        course_id,
        joined_from,
        joined_to,
        sortBy = 'id',
        sortOrder = 'DESC',
        lean,
    } = query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const andConditions = [];

    if (search) {
        andConditions.push({
            [Op.or]: [
                { name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } },
                { phone: { [Op.like]: `%${search}%` } },
            ],
        });
    }

    if (email != null && String(email).trim() !== '') {
        const e = String(email).trim();
        andConditions.push({ email: { [Op.like]: `%${e}%` } });
    }

    if (state != null && String(state).trim() !== '') {
        const s = String(state).trim().toLowerCase();
        andConditions.push(
            Sequelize.where(
                Sequelize.fn('LOWER', Sequelize.col('state')),
                Op.like,
                `%${s}%`
            )
        );
    }

    if (designation != null && String(designation).trim() !== '') {
        const d = String(designation).trim().toLowerCase();
        andConditions.push(
            Sequelize.where(
                Sequelize.fn('LOWER', Sequelize.col('designation')),
                Op.like,
                `${d}%`
            )
        );
    }

    if (profession != null && String(profession).trim() !== '') {
        const p = String(profession).trim().toLowerCase();
        andConditions.push(
            Sequelize.where(
                Sequelize.fn('LOWER', Sequelize.col('profession')),
                Op.like,
                `${p}%`
            )
        );
    }

    if (status != null && String(status).trim() !== '') {
        const s = String(status).trim().toLowerCase();
        if (s === 'active') {
            andConditions.push({ is_active: true });
        } else if (s === 'inactive') {
            andConditions.push({ is_active: false });
        } else {
            andConditions.push({ status: s });
        }
    }

    /**
     * Membership filter — canonical source is `user_memberships` (active rows).
     * `users.membership` is set to "1" by access.grantMembership, so filtering on
     * that column alone silently drops every granted user from the export.
     */
    if (membership !== undefined && membership !== '') {
        const m = String(membership).trim().toLowerCase();
        if (m === 'free') {
            andConditions.push({
                id: {
                    [Op.notIn]: Sequelize.literal(
                        '(SELECT um.user_id FROM user_memberships um WHERE um.expires_at > NOW())'
                    ),
                },
            });
        } else {
            const escapedSlug = sequelize.escape(m);
            andConditions.push({
                id: {
                    [Op.in]: Sequelize.literal(
                        `(SELECT um.user_id FROM user_memberships um WHERE um.expires_at > NOW() AND LOWER(um.membership_type) = ${escapedSlug})`
                    ),
                },
            });
        }
    }

    /**
     * Course filter — uses `user_courses` (granted course access either via direct
     * purchase or via membership lazy-enrollment).
     */
    if (course_id != null && String(course_id).trim() !== '') {
        const cid = parseInt(String(course_id).trim(), 10);
        if (Number.isFinite(cid) && cid > 0) {
            andConditions.push({
                id: {
                    [Op.in]: Sequelize.literal(
                        `(SELECT uc.user_id FROM user_courses uc WHERE uc.course_id = ${cid})`
                    ),
                },
            });
        }
    }

    logger.info('[users.list] date filter', { joined_from, joined_to, full_query: query });

    const createdRange = buildCreatedAtRange(joined_from, joined_to, Op);
    if (createdRange) {
        andConditions.push({ created_at: createdRange });
    }

    if (role_id) {
        andConditions.push({ role_id: parseInt(role_id, 10) });
    } else if (role != null && String(role).trim() !== '') {
        const key = String(role).trim().toLowerCase();
        const names = ROLE_FILTER_ALIASES[key] || [key];
        const lowered = names.map((n) => n.toLowerCase());
        const roleRows = await Role.findAll({
            where: Sequelize.where(
                Sequelize.fn('LOWER', Sequelize.col('name')),
                { [Op.in]: lowered },
            ),
            attributes: ['id'],
            raw: true,
        });
        const roleIds = roleRows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
        const orClauses = [];
        if (roleIds.length) orClauses.push({ role_id: { [Op.in]: roleIds } });
        orClauses.push(
            Sequelize.where(
                Sequelize.fn('LOWER', Sequelize.col('role')),
                { [Op.in]: lowered },
            ),
        );
        andConditions.push({ [Op.or]: orClauses });
    }

    const trashMode = parseTrashedMode(query);
    const baseWhere = andConditions.length > 0 ? { [Op.and]: andConditions } : {};
    const where = withTrashedWhere(baseWhere, trashMode);

    const orderDir = ['ASC', 'DESC'].includes(String(sortOrder).toUpperCase())
        ? String(sortOrder).toUpperCase()
        : 'DESC';

    const order = sortBy === 'id'
        ? [['id', orderDir]]
        : [[sortBy, orderDir], ['id', orderDir]];

    const TABLE_COLUMNS = [
        'id', 'wp_user_id', 'name', 'display_name', 'email', 'phone',
        'first_name', 'last_name', 'designation', 'profession', 'company',
        'state', 'city', 'country', 'bio', 'role', 'role_id', 'status', 'is_active',
        'created_at', 'gst',
    ];
    const attributes = (lean === 'true' || lean === true)
        ? ['id', 'wp_user_id', 'name', 'display_name', 'email', 'role_id', 'role', 'designation', 'profession']
        : TABLE_COLUMNS;

    return {
        where,
        trashMode,
        order,
        attributes,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        offset,
        sortBy,
    };
}

async function list(query = {}) {
    const ctx = await buildListQueryContext(query);

    const { count, rows } = await User.findAndCountAll({
        where: ctx.where,
        attributes: ctx.attributes,
        offset: ctx.offset,
        limit: ctx.limit,
        order: ctx.order,
        raw: true,
        nest: true,
        ...trashedSequelizeOptions(ctx.trashMode),
    });

    const membershipMap = await fetchLatestMembershipsByUserIds(rows);
    const data = enrichUsersWithMembership(rows, membershipMap);

    return {
        data,
        total: count,
        page: ctx.page,
        limit: ctx.limit,
        pages: Math.ceil(count / ctx.limit) || 0,
    };
}

async function countForExport(query = {}) {
    const ctx = await buildListQueryContext({ ...query, page: 1, limit: 1, lean: true });
    const total = await User.count({
        where: ctx.where,
        ...trashedSequelizeOptions(ctx.trashMode),
    });
    return { total };
}

async function* iterateExportBatches(query) {
    // Always paginate by primary key for export — simple `id < lastId` is O(1) on the PK index
    // and avoids the expensive OR-based composite cursor needed for non-unique sort columns.
    // Descending order (newest users first) matches what users expect in the CSV.
    const ctx = await buildListQueryContext({ ...query, page: 1, limit: EXPORT_BATCH_SIZE, lean: true });

    const exportAttributes = [
        'id', 'wp_user_id', 'name', 'display_name', 'email', 'phone',
        'first_name', 'last_name', 'designation', 'profession', 'company',
        'state', 'city', 'country', 'bio', 'role', 'role_id', 'status',
        'created_at', 'plan', 'gst',
    ];

    let lastId = null;

    for (;;) {
        const andParts = [ctx.where];
        if (lastId !== null) {
            andParts.push({ id: { [Op.lt]: lastId } });
        }

        const rows = await User.findAll({
            where: { [Op.and]: andParts },
            attributes: exportAttributes,
            limit: EXPORT_BATCH_SIZE,
            order: [['id', 'DESC']],
            raw: true,
            nest: true,
            ...trashedSequelizeOptions(ctx.trashMode),
        });

        if (!rows.length) break;

        const membershipMap = await fetchLatestMembershipsByUserIds(rows);
        const enriched = enrichUsersWithMembership(rows, membershipMap);
        yield enriched;

        lastId = rows[rows.length - 1].id;
        if (rows.length < EXPORT_BATCH_SIZE) break;
    }
}

async function writeExportToFile(query, filePath, onProgress, knownTotal) {
    const total = knownTotal ?? (await countForExport(query)).total;
    const header = `\uFEFF${USER_EXPORT_CSV_HEADERS.map(escapeCsvCell).join(',')}\r\n`;
    await fs.promises.writeFile(filePath, header, 'utf8');

    let loaded = 0;
    for await (const batch of iterateExportBatches(query)) {
        const lines = batch.map((user) => `${userRowToExportCsvLine(user)}\r\n`).join('');
        if (lines) {
            await fs.promises.appendFile(filePath, lines, 'utf8');
        }
        loaded += batch.length;
        if (onProgress) {
            onProgress({ loaded, total, phase: 'fetching' });
        }
    }

    if (onProgress) {
        onProgress({ loaded, total, phase: 'writing' });
    }

    return { exported: loaded, total };
}

/**
 * Stream users CSV export in batches (keyset pagination matching list sort order).
 * Membership columns come from user_memberships + premium_plans; purchase price from users.plan JSON when stored.
 */
async function exportCsvStream(query, res) {
    const datePart = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="users-export-${datePart}.csv"`);
    res.write('\uFEFF');
    res.write(`${USER_EXPORT_CSV_HEADERS.map(escapeCsvCell).join(',')}\r\n`);

    let exported = 0;
    for await (const batch of iterateExportBatches(query)) {
        for (const user of batch) {
            res.write(`${userRowToExportCsvLine(user)}\r\n`);
        }
        exported += batch.length;
    }

    logger.info('[users.exportCsvStream] completed', { exported });
    res.end();
}

// ─── Get One ─────────────────────────────────────────────────────────────────

async function getOne(id) {
    const user = await User.findByPk(id, {
        include: [{ model: Role, as: 'Role', attributes: ['id', 'name'] }],
        attributes: { exclude: ['password_hash'] },
    });
    return user;
}

async function create(data) {
    const { password, role, country, ...fields } = data;

    if (!data.email) throw new AppError('Email is required', 400);

    const effectivePassword =
        password != null && String(password).trim() !== ''
            ? String(password).trim()
            : crypto.randomBytes(24).toString('base64url');

    const password_hash = await bcrypt.hash(effectivePassword, 10);

    const countryStored =
        country != null && String(country).trim() !== ''
            ? String(country).trim()
            : 'India';

    let role_id = data.role_id || 1;
    if (role) {
        const roleRecord = await Role.findOne({ where: { name: role } });
        if (roleRecord) role_id = roleRecord.id;
    }

    const user = await User.create({
        ...fields,
        country: countryStored,
        password_hash,
        role_id,
        is_active: true,
    });

    logger.info('User created', { id: user.id, email: data.email });
    return getOne(user.id);
}

async function update(id, data) {
    const user = await User.findByPk(id);
    if (!user) return null;

    if (data.password) {
        data.password_hash = await bcrypt.hash(data.password, 10);
        delete data.password;
    }

    await user.update(data);
    logger.info('User updated', { id });
    return getOne(id);
}

async function remove(id) {
    const user = await User.findByPk(id);
    if (!user) return false;

    await user.destroy();
    logger.info('User moved to trash', { id });
    return true;
}

async function restore(id) {
    const user = await User.findByPk(id, { paranoid: false });
    if (!user || !user.deleted_at) return false;
    await user.restore();
    logger.info('User restored from trash', { id });
    return true;
}

async function listByIds(ids) {
    if (!ids || ids.length === 0) return [];
    return await User.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ['id', 'name', 'email', 'phone'],
        raw: true
    });
}

/**
 * Resolve user IDs whose name / email / phone partially match a search term.
 * Used by order-service so an order search by buyer name/email/phone also finds
 * orders whose buyer details live on the linked user record, not the order row.
 * Capped to avoid unbounded IN() clauses.
 */
async function searchIds(term, { limit = 2000 } = {}) {
    const q = String(term || '').trim();
    if (!q) return [];
    const rows = await User.findAll({
        where: {
            [Op.or]: [
                { name: { [Op.like]: `%${q}%` } },
                { email: { [Op.like]: `%${q}%` } },
                { phone: { [Op.like]: `%${q}%` } },
            ],
        },
        attributes: ['id'],
        limit: Math.min(Number(limit) || 2000, 5000),
        raw: true,
    });
    return rows.map((r) => r.id);
}

/** Returns all distinct non-empty state values from the users table, sorted alphabetically. */
async function distinctStates() {
    const rows = await User.findAll({
        attributes: ['state'],
        where: {
            state: {
                [Op.and]: [
                    { [Op.ne]: null },
                    { [Op.ne]: '' },
                ],
            },
        },
        group: ['state'],
        order: [['state', 'ASC']],
        raw: true,
    });
    return rows.map((r) => r.state).filter(Boolean);
}

async function count() {
    const total = await User.count();
    return { total };
}

module.exports = {
    list,
    countForExport,
    writeExportToFile,
    exportCsvStream,
    getOne,
    create,
    update,
    remove,
    restore,
    listByIds,
    searchIds,
    distinctStates,
    count,
};
