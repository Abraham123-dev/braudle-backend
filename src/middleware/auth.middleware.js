import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const verifyJWT = (req, res, next) => {
  try {
    const token = req.cookies.jwt;

    if (!token) {
      throw new AppError('No authentication token provided', 401);
    }

    const decoded = jwt.verify(token, env.jwt.secret);
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AppError('Invalid or expired token', 401);
    }
    throw error;
  }
};

export { verifyJWT };
