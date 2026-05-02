const Joi = require('joi');

const createOrder = {
    body: Joi.object({
        type: Joi.string().valid('course', 'membership').required(),
        entityId: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().min(1)).required(),
        // amount is intentionally excluded — always fetched from the backend
        currency: Joi.string().length(3).uppercase().default('INR'),
        couponCode: Joi.string().max(64).allow('', null),
        referralCode: Joi.string().max(32).allow('', null),
    }),
};

const verifyOrder = {
    body: Joi.object({
        orderId: Joi.string().required(),
        razorpay_order_id: Joi.string().required(),
        razorpay_payment_id: Joi.string().required(),
        razorpay_signature: Joi.string().required(),
    }),
};

const getCoupon = {
    query: Joi.object({
        type: Joi.string().uppercase().valid('COURSE', 'MEMBERSHIP'),
        id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().min(1)),
    }).with('type', 'id').with('id', 'type'),
};

const applyCoupon = {
    body: Joi.object({
        couponCode: Joi.string().trim().required(),
        type: Joi.string().uppercase().valid('COURSE', 'MEMBERSHIP').required(),
        id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().min(1)).required(),
    }),
};

const invoiceParam = {
  params: Joi.object({
    orderId: Joi.string().required(),
  }),
};

const paymentLinkCreateOrder = {
  body: Joi.object({
    paymentLinkId: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().min(1)).required(),
    fullName: Joi.string().trim().min(1).max(250).required(),
    email: Joi.string().trim().email().max(255).required(),
    mobile: Joi.string().trim().min(8).max(24).required(),
    gstNumber: Joi.string().trim().max(32).allow('', null),
    referralCode: Joi.string().max(32).allow('', null),
  }),
};

const paymentLinkVerifyOrder = {
  body: Joi.object({
    orderId: Joi.string().required(),
    razorpay_order_id: Joi.string().required(),
    razorpay_payment_id: Joi.string().required(),
    razorpay_signature: Joi.string().required(),
  }),
};

module.exports = {
  createOrder,
  verifyOrder,
  getCoupon,
  applyCoupon,
  invoiceParam,
  paymentLinkCreateOrder,
  paymentLinkVerifyOrder,
};
