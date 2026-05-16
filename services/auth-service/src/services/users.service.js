const { User, Role } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { AppError, logger } = require('../../../../shared');

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
        joined_from,
        joined_to,
        sortBy = 'id',
        sortOrder = 'DESC',
    } = query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const where = {};

    if (search) {
        where[Op.or] = [
            { name: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { phone: { [Op.like]: `%${search}%` } },
        ];
    }

    if (email) {
        where.email = { [Op.like]: `%${email}%` };
    }

    if (role_id) {
        where.role_id = role_id;
    } else if (role) {
        const roleRecord = await Role.findOne({ where: { name: role } });
        where.role_id = roleRecord ? roleRecord.id : -1;
    }

    if (status) where.status = status;
    if (membership !== undefined && membership !== '') where.membership = membership;

    if (joined_from || joined_to) {
        where.created_at = {};
        if (joined_from) {
            const start = new Date(joined_from);
            if (!Number.isNaN(start.getTime())) where.created_at[Op.gte] = start;
        }
        if (joined_to) {
            const end = new Date(joined_to);
            if (!Number.isNaN(end.getTime())) {
                end.setHours(23, 59, 59, 999);
                where.created_at[Op.lte] = end;
            }
        }
    }

    const orderDir = ['ASC', 'DESC'].includes(String(sortOrder).toUpperCase())
        ? String(sortOrder).toUpperCase()
        : 'DESC';

    const { count, rows } = await User.findAndCountAll({
        where,
        include: [{ model: Role, as: 'Role', attributes: ['id', 'name'] }],
        attributes: { exclude: ['password_hash'] },
        offset,
        limit: parseInt(limit, 10),
        order: [[sortBy, orderDir]],
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
