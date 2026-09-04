import User from "../models/User.js";
import Progress from "../models/Progress.js";
import { generateToken } from "../utils/generateToken.js";
import { verifyFirebaseToken } from "../utils/verifyFirebaseToken.js";

// Comma-separated list of emails that should automatically become admins,
// set via ADMIN_EMAILS in .env, e.g. ADMIN_EMAILS=you@example.com,other@example.com
function isConfiguredAdmin(email) {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

// @route POST /api/auth/signup
export async function signup(req, res, next) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are all required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: "An account with this email already exists" });
    }

    const role = isConfiguredAdmin(email) ? "admin" : "student";
    const user = await User.create({ name, email, password, role, lastLoginAt: new Date() });

    // Create an empty progress document for this user right away
    await Progress.create({ user: user._id });

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  } catch (err) {
    next(err);
  }
}

// @route POST /api/auth/login
export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    user.lastLoginAt = new Date();
    if (isConfiguredAdmin(user.email) && user.role !== "admin") user.role = "admin";
    await user.save();

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  } catch (err) {
    next(err);
  }
}

// @route GET /api/auth/me  (protected)
export async function getMe(req, res, next) {
  try {
    res.json({
      _id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    });
  } catch (err) {
    next(err);
  }
}

// @route POST /api/auth/google
// body: { idToken: string }  — the Firebase ID token from getIdToken() on the frontend
export async function googleAuth(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ message: "idToken is required" });
    }

    let decoded;
    try {
      decoded = await verifyFirebaseToken(idToken);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired Google sign-in token" });
    }

    const email = decoded.email;
    if (!email) {
      return res.status(400).json({ message: "This Google account has no email address" });
    }
    const name = decoded.name || email.split("@")[0];
    const googleId = decoded.user_id || decoded.sub;

    let user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Brand new user signing in with Google for the first time
      const role = isConfiguredAdmin(email) ? "admin" : "student";
      user = await User.create({ name, email, provider: "google", googleId, role, lastLoginAt: new Date() });
      await Progress.create({ user: user._id });
    } else {
      // Existing account (e.g. signed up with email/password before) — link Google to it
      if (!user.googleId) user.googleId = googleId;
      if (isConfiguredAdmin(user.email) && user.role !== "admin") user.role = "admin";
      user.lastLoginAt = new Date();
      await user.save();
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  } catch (err) {
    next(err);
  }
}
