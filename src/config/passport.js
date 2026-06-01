import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from './env.js';
import User from '../models/User.model.js';
import { AppError } from '../utils/AppError.js';

passport.use(
  new GoogleStrategy(
    {
      clientID: env.google.clientId,
      clientSecret: env.google.clientSecret,
      callbackURL: env.google.callbackUrl,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value || '';
        const avatar = profile.photos?.[0]?.value || null;
        const name = profile.displayName || 'User';

        let user = await User.findOne({ googleId });
        if (!user && email) {
          user = await User.findOne({ email });
          if (user) {
            if (user.googleId && user.googleId !== googleId) {
              throw new AppError('Email already linked to another Google account', 409);
            }
            user.googleId = googleId;
          }
        }

        if (!user) {
          user = await User.create({
            googleId,
            name,
            email,
            avatar,
          });
        } else {
          user.name = name;
          user.avatar = avatar;
          await user.save();
        }

        return done(null, user);
      } catch (error) {
        return done(new AppError(error.message || 'Google authentication failed', 500));
      }
    }
  )
);

export default passport;
