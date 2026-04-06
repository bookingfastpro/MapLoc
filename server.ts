import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(process.cwd(), "zones.json");
const PLACES_FILE = path.join(process.cwd(), "places.json");

// Initial data if file doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}
if (!fs.existsSync(PLACES_FILE)) {
  fs.writeFileSync(PLACES_FILE, JSON.stringify([]));
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

// Places Endpoints
app.get("/api/places", (req, res) => {
  try {
    const data = fs.readFileSync(PLACES_FILE, "utf-8");
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: "Failed to read places" });
  }
});

app.post("/api/places", authenticate, (req, res) => {
  try {
    const places = JSON.parse(fs.readFileSync(PLACES_FILE, "utf-8"));
    const newPlace = { ...req.body, id: uuidv4() };
    places.push(newPlace);
    fs.writeFileSync(PLACES_FILE, JSON.stringify(places, null, 2));
    res.status(201).json(newPlace);
  } catch (error) {
    res.status(500).json({ error: "Failed to save place" });
  }
});

app.put("/api/places/:id", authenticate, (req, res) => {
  try {
    let places = JSON.parse(fs.readFileSync(PLACES_FILE, "utf-8"));
    const index = places.findIndex((p: any) => p.id === req.params.id);
    if (index !== -1) {
      places[index] = { ...req.body, id: req.params.id };
      fs.writeFileSync(PLACES_FILE, JSON.stringify(places, null, 2));
      res.json(places[index]);
    } else {
      res.status(404).json({ error: "Place not found" });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to update place" });
  }
});

app.delete("/api/places/:id", authenticate, (req, res) => {
  try {
    let places = JSON.parse(fs.readFileSync(PLACES_FILE, "utf-8"));
    places = places.filter((p: any) => p.id !== req.params.id);
    fs.writeFileSync(PLACES_FILE, JSON.stringify(places, null, 2));
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete place" });
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

app.post("/api/import", authenticate, (req, res) => {
  try {
    const importedData = req.body;
    let zonesToImport = [];
    let placesToImport = [];

    if (Array.isArray(importedData)) {
      // Old format: just an array of zones
      zonesToImport = importedData;
    } else {
      // New format: object with zones and/or places
      zonesToImport = importedData.zones || [];
      placesToImport = importedData.places || [];
    }
    
    // Process Zones
    if (zonesToImport.length > 0) {
      const zonesWithIds = zonesToImport.map((z: any) => ({
        ...z,
        id: z.id || uuidv4()
      }));
      fs.writeFileSync(DATA_FILE, JSON.stringify(zonesWithIds, null, 2));
    }

    // Process Places
    if (placesToImport.length > 0) {
      const placesWithIds = placesToImport.map((p: any) => ({
        ...p,
        id: p.id || uuidv4()
      }));
      fs.writeFileSync(PLACES_FILE, JSON.stringify(placesWithIds, null, 2));
    }

    res.json({ 
      message: "Data imported successfully", 
      zonesCount: zonesToImport.length,
      placesCount: placesToImport.length
    });
  } catch (error) {
    console.error("Import error:", error);
    res.status(500).json({ error: "Failed to import data" });
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
