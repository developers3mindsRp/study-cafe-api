const { User, Role } = require('../models');
const { Op, Sequelize } = require('sequelize');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { AppError, logger } = require('../../../../shared');

async function list(query = {}) {
    const {
        page = 1,
        limit = 10,
        search,
        role_id,
        role: roleNameFilter,
        status,
        membership,
        email: emailFilter,
        state: stateFilter,
        joined_from,
        joined_to,
        sortBy = 'id',
        sortOrder = 'DESC',
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

    if (emailFilter != null && String(emailFilter).trim() !== '') {
        const e = String(emailFilter).trim();
        andConditions.push({ email: { [Op.like]: `%${e}%` } });
    }

    if (stateFilter != null && String(stateFilter).trim() !== '') {
        const s = String(stateFilter).trim();
        andConditions.push({ state: { [Op.like]: `%${s}%` } });
    }

    if (status) andConditions.push({ status });

    if (membership !== undefined && membership !== '') {
        const m = String(membership).trim();
        if (m.toLowerCase() === 'free') {
            andConditions.push({
                [Op.or]: [
                    { membership: { [Op.is]: null } },
                    { membership: '' },
                    Sequelize.where(
                        Sequelize.fn('LOWER', Sequelize.col('membership')),
                        Op.eq,
                        'free'
                    ),
                ],
            });
        } else {
            andConditions.push({ membership: m });
        }
    }

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

    const roleInclude = {
        model: Role,
        as: 'Role',
        attributes: ['id', 'name'],
    };
    if (roleNameFilter != null && String(roleNameFilter).trim() !== '') {
        roleInclude.where = { name: String(roleNameFilter).trim() };
        roleInclude.required = true;
    } else if (role_id) {
        andConditions.push({ role_id: parseInt(role_id, 10) });
    }

    const where = andConditions.length > 0 ? { [Op.and]: andConditions } : {};

    const orderDir = ['ASC', 'DESC'].includes(String(sortOrder).toUpperCase())
        ? String(sortOrder).toUpperCase()
        : 'DESC';

    const { count, rows } = await User.findAndCountAll({
        where,
        include: [roleInclude],
        attributes: { exclude: ['password_hash'] },
        offset,
        limit: parseInt(limit, 10),
        order: [[sortBy, orderDir]],
        distinct: true,
    });

    return {
        data: rows,
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
    logger.info('User deleted', { id });
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

module.exports = { list, getOne, create, update, remove, listByIds };
