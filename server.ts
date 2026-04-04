import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(process.cwd(), "zones.json");

// Initial data if file doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

app.use(cors());
app.use(express.json());

// Simple Auth Middleware (Mock)
const ADMIN_PASSWORD = "admin"; // In a real app, use env vars and hashing
const ADMIN_TOKEN = "secret-admin-token";

const authenticate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${ADMIN_TOKEN}`) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

// API Routes
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ token: ADMIN_TOKEN });
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
});

app.get("/api/zones", (req, res) => {
  try {
    const data = fs.readFileSync(DATA_FILE, "utf-8");
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: "Failed to read zones" });
  }
});

app.post("/api/zones", authenticate, (req, res) => {
  try {
    const zones = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    const newZone = { ...req.body, id: uuidv4() };
    zones.push(newZone);
    fs.writeFileSync(DATA_FILE, JSON.stringify(zones, null, 2));
    res.status(201).json(newZone);
  } catch (error) {
    res.status(500).json({ error: "Failed to save zone" });
  }
});

app.put("/api/zones/:id", authenticate, (req, res) => {
  try {
    let zones = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    const index = zones.findIndex((z: any) => z.id === req.params.id);
    if (index !== -1) {
      zones[index] = { ...req.body, id: req.params.id };
      fs.writeFileSync(DATA_FILE, JSON.stringify(zones, null, 2));
      res.json(zones[index]);
    } else {
      res.status(404).json({ error: "Zone not found" });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to update zone" });
  }
});

app.delete("/api/zones/:id", authenticate, (req, res) => {
  try {
    let zones = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    zones = zones.filter((z: any) => z.id !== req.params.id);
    fs.writeFileSync(DATA_FILE, JSON.stringify(zones, null, 2));
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete zone" });
  }
});

app.post("/api/zones/import", authenticate, (req, res) => {
  try {
    const importedZones = req.body;
    if (!Array.isArray(importedZones)) {
      return res.status(400).json({ error: "Invalid data format. Expected an array of zones." });
    }
    
    // Ensure all zones have IDs
    const zonesWithIds = importedZones.map((z: any) => ({
      ...z,
      id: z.id || uuidv4()
    }));

    fs.writeFileSync(DATA_FILE, JSON.stringify(zonesWithIds, null, 2));
    res.json({ message: "Zones imported successfully", count: zonesWithIds.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to import zones" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
