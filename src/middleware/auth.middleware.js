import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import User from '../models/User.model.js';

const verifyJWT = async (req, res, next) => {
  try {
    // Look for token in cookies first, then fallback to Authorization header
    let token = req.cookies?.braudle_token;

    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(new AppError('No authentication token provided', 401));
    }

    const decoded = jwt.verify(token, env.jwt.secret);

    // Enforce the expected JWT payload contract.
    if (!decoded?.id) {
      return next(new AppError('Invalid token payload', 401));
    }

    // Security fix: Verify user still exists in DB
    const user = await User.findById(decoded.id).select('_id');
    if (!user) {
      return next(new AppError('User account no longer exists or is inactive', 401));
    }

    req.user = { id: user._id.toString() };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError('Invalid or expired token', 401));
    }
    next(error);
  }
};

export { verifyJWT };
