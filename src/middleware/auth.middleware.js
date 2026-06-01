import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const verifyJWT = (req, res, next) => {
  try {
    const token = req.cookies?.braudle_token;

    if (!token) {
      throw new AppError('No authentication token provided', 401);
    }

    const decoded = jwt.verify(token, env.jwt.secret);

    // Enforce the expected JWT payload contract.
    if (!decoded?.id) {
      throw new AppError('Invalid token payload', 401);
    }

    // Hard contract: controller/use sites expect req.user.id, not the entire decoded payload.
    req.user = { id: decoded.id };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AppError('Invalid or expired token', 401);
    }
    throw error;
  }
};

export { verifyJWT };
