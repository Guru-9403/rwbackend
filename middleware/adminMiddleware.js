// Must run AFTER `protect` (needs req.user already set).
export function adminOnly(req, res, next) {
  if (req.user && req.user.role === "admin") {
    return next();
  }
  return res.status(403).json({ message: "Admin access only" });
}
