const { User, Role, sequelize } = require('../models');
const { Op, Sequelize } = require('sequelize');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { AppError, logger, parseTrashedMode, trashedSequelizeOptions, withTrashedWhere } = require('../../../../shared');

/** Admin list role filter values → roles.name (and users.role legacy column). */
const ROLE_FILTER_ALIASES = {
    student: ['user', 'student'],
    instructor: ['instructor'],
    admin: ['admin'],
};

async function list(query = {}) {
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

    const createdRange = {};
    if (joined_from) {
        const d = new Date(joined_from);
        if (!Number.isNaN(d.getTime())) createdRange[Op.gte] = d;
    }
    if (joined_to) {
        const d = new Date(joined_to);
        if (!Number.isNaN(d.getTime())) {
            d.setHours(23, 59, 59, 999);
            createdRange[Op.lte] = d;
        }
    }
    if (Object.keys(createdRange).length > 0) {
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

    // Only select columns needed by the admin table — avoids transferring bio, social links, etc.
    const TABLE_COLUMNS = [
        'id', 'name', 'display_name', 'email', 'phone',
        'designation', 'profession', 'company', 'state', 'city', 'country',
        'membership', 'plan', 'role_id', 'status', 'is_active',
        'created_at', 'gst',
    ];
    const attributes = (lean === 'true' || lean === true)
        ? ['id', 'name', 'display_name', 'email', 'role_id', 'designation', 'profession', 'plan']
        : TABLE_COLUMNS;

    const { count, rows } = await User.findAndCountAll({
        where,
        attributes,
        offset,
        limit: parseInt(limit, 10),
        order,
        raw: true,
        nest: true,
        ...trashedSequelizeOptions(trashMode),
    });

    const data = rows.map((u) => {
        u.membership_name = u.plan
            ? u.plan.charAt(0).toUpperCase() + u.plan.slice(1)
            : null;
        return u;
    });

    return {
        data,
        total: count,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(count / parseInt(limit, 10)),
    };
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

module.exports = { list, getOne, create, update, remove, listByIds, distinctStates, count };
