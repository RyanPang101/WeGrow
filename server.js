import express from "express";
import cors from "cors";
import fs from "fs";
import { nanoid } from "nanoid";

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = "./db.json";
const readDB = () => JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
const writeDB = (data) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));

/*
  NOTE: This is a prototype. Auth is intentionally simple (no hashing/JWT).
  Do NOT use in production as-is.
*/

// --- Auth & Profiles ---
app.post("/api/auth/signup", (req, res) => {
  const { name, email, location } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  const db = readDB();
  if (db.users.find(u => u.email === email)) {
    return res.status(409).json({ error: "Email already exists" });
  }
  const user = {
    id: nanoid(),
    name: name || "New Grower",
    email,
    location: location || "",
    bio: "",
    interests: [],
    membershipTier: "free",
    points: 0,
    badges: []
  };
  db.users.push(user);
  writeDB(db);
  res.json({ user, token: user.id }); // token = user.id (mock)
});

app.post("/api/auth/login", (req, res) => {
  const { email } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user, token: user.id });
});

const getUser = (req) => {
  const token = req.headers["x-auth"];
  if (!token) return null;
  const db = readDB();
  return db.users.find(u => u.id === token) || null;
};

// --- Listings ---
app.get("/api/listings", (req, res) => {
  const db = readDB();
  const { type, q } = req.query; // optional filters
  let out = db.listings;
  if (type) out = out.filter(l => l.type === type);
  if (q) out = out.filter(l =>
    (l.plantName + " " + l.description).toLowerCase().includes(String(q).toLowerCase())
  );
  res.json(out);
});

app.post("/api/listings", (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { plantName, description, type, location, radiusKm, photoUrl } = req.body;
  if (!plantName || !type) return res.status(400).json({ error: "Missing fields" });
  const db = readDB();
  const listing = {
    id: nanoid(),
    ownerId: user.id,
    plantName,
    description: description || "",
    type, // "Have" | "Want"
    location: location || user.location || "",
    radiusKm: radiusKm || 2,
    photoUrl: photoUrl || ""
  };
  db.listings.unshift(listing);
  // Gamification: +10 points per listing
  const u = db.users.find(u => u.id === user.id);
  u.points = (u.points || 0) + 10;
  writeDB(db);
  res.json(listing);
});

// --- Messages (simple thread per pair) ---
app.get("/api/messages/:peerId", (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const db = readDB();
  const peerId = req.params.peerId;
  const msgs = db.messages.filter(m =>
    (m.fromId === user.id && m.toId === peerId) ||
    (m.fromId === peerId && m.toId === user.id)
  ).sort((a,b)=>a.ts - b.ts);
  res.json(msgs);
});

app.post("/api/messages/:peerId", (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Text required" });
  const db = readDB();
  const msg = { id: nanoid(), fromId: user.id, toId: req.params.peerId, text, ts: Date.now() };
  db.messages.push(msg);
  writeDB(db);
  res.json(msg);
});

// --- Guides (static for MVP) ---
app.get("/api/guides", (req, res) => {
  const db = readDB();
  res.json(db.guides);
});

// --- Quests & Points ---
app.get("/api/quests", (req, res) => {
  const db = readDB();
  res.json(db.quests);
});

app.post("/api/quests/complete/:questId", (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const db = readDB();
  const quest = db.quests.find(q => q.id === req.params.questId);
  if (!quest) return res.status(404).json({ error: "Quest not found" });

  const u = db.users.find(u => u.id === user.id);
  u.points = (u.points || 0) + (quest.points || 0);

  // Award a simple badge for demo
  u.badges = u.badges || [];
  if (!u.badges.includes(quest.id)) u.badges.push(quest.id);

  writeDB(db);
  res.json({ ok: true, points: u.points, badges: u.badges });
});

// --- Rewards Store & Redemption ---
app.get("/api/rewards", (req, res) => {
  const db = readDB();
  res.json(db.rewards);
});

app.post("/api/rewards/redeem/:rewardId", (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const db = readDB();
  const reward = db.rewards.find(r => r.id === req.params.rewardId);
  if (!reward) return res.status(404).json({ error: "Reward not found" });

  const u = db.users.find(u => u.id === user.id);
  if ((u.points || 0) < reward.pointsCost) {
    return res.status(400).json({ error: "Not enough points" });
  }
  u.points -= reward.pointsCost;
  db.transactions.push({
    id: nanoid(),
    userId: u.id,
    itemId: reward.id,
    pointsSpent: reward.pointsCost,
    cashAmount: 0,
    date: Date.now()
  });
  writeDB(db);
  res.json({ ok: true, remainingPoints: u.points });
});

// --- Sellers & Marketplace (read-only for MVP) ---
app.get("/api/sellers", (req, res) => {
  const db = readDB();
  res.json(db.sellers);
});

// Health
app.get("/api/health", (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`WeGrow API running on http://localhost:${PORT}`));
