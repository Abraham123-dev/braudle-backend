import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const verifyAdminJWT = async (req, res, next) => {
  try {
    let token = req.cookies?.braudle_admin_token;

    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(new AppError('Unauthorized: Lighthouse access required', 401));
    }

    const decoded = jwt.verify(token, env.jwt.secret);

    if (decoded?.email !== 'abrahamoluwaniyi50@gmail.com') {
      return next(new AppError('Forbidden: Lighthouse access denied', 403));
    }

    req.admin = { email: decoded.email };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError('Unauthorized: Invalid or expired administrative session', 401));
    }
    next(error);
  }
};

export { verifyAdminJWT };
