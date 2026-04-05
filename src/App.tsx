import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Polygon, Marker, CircleMarker, useMap, useMapEvents, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { Zone, UserPosition, Place } from './types';
import { MapPin, Navigation, Plus, Trash2, Save, X, LogOut, Settings, Download, Upload } from 'lucide-react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle } from 'lucide-react';

// Point-in-polygon algorithm (Ray Casting)
function isPointInPolygon(point: [number, number], polygon: [number, number][]) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Fix Leaflet icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// Custom User Marker
const createUserIcon = (heading: number | null, isWarning: boolean) => {
  const rotation = heading !== null ? `transform: rotate(${heading}deg);` : 'display: none;';
  const warningClass = isWarning ? 'warning' : '';
  return L.divIcon({
    className: 'user-marker-container',
    html: `
      <div class="user-marker ${warningClass}">
        <div class="user-marker-pulse"></div>
        <div class="user-marker-heading" style="${rotation}">
          <div class="user-marker-arrow"></div>
        </div>
      </div>
    `,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
};

// Custom Point Marker for drawing/editing
const createPointIcon = (color: string) => L.divIcon({
  className: 'custom-point-marker',
  html: `<div style="background-color: white; border: 3px solid ${color}; width: 12px; height: 12px; border-radius: 50%;"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6]
});

// Component to center map on user position
function ChangeView({ center, shouldCenter }: { center: [number, number], shouldCenter: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (shouldCenter) {
      const currentZoom = map.getZoom();
      const targetZoom = currentZoom < 18 ? 18 : currentZoom;
      
      // If zoom is already correct, use panTo for smoother tracking
      if (currentZoom === targetZoom) {
        map.panTo(center, {
          animate: true,
          duration: 0.5,
          noMoveStart: true
        });
      } else {
        // If zoom needs changing, use setView
        map.setView(center, targetZoom, {
          animate: true,
          duration: 1
        });
      }
    }
  }, [center, map, shouldCenter]);
  return null;
}

// Component to handle map clicks for drawing and user interactions
function MapEventsHandler({ 
  onMapClick, 
  isDrawing, 
  isAddingPlace,
  onUserInteraction 
}: { 
  onMapClick: (lat: number, lng: number) => void, 
  isDrawing: boolean,
  isAddingPlace: boolean,
  onUserInteraction: () => void
}) {
  useMapEvents({
    click: (e) => {
      if (isDrawing || isAddingPlace) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
    dragstart: () => onUserInteraction(),
    zoomstart: () => onUserInteraction(),
    mousedown: () => onUserInteraction(), // Catch any interaction
  });
  return null;
}

export default function App() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [userPos, setUserPos] = useState<UserPosition | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState<string | null>(localStorage.getItem('adminToken'));
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [shouldCenter, setShouldCenter] = useState(true);
  const [activeWarning, setActiveWarning] = useState<Zone | null>(null);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [newZonePoints, setNewZonePoints] = useState<[number, number][]>([]);
  const [newZoneColor, setNewZoneColor] = useState<'red' | 'green' | 'yellow'>('red');
  const [newZoneName, setNewZoneName] = useState('');

  // Place state
  const [isAddingPlace, setIsAddingPlace] = useState(false);
  const [newPlaceName, setNewPlaceName] = useState('');
  const [newPlacePos, setNewPlacePos] = useState<[number, number] | null>(null);

  // Fetch zones
  const fetchZones = async () => {
    try {
      const res = await axios.get('/api/zones');
      setZones(res.data);
    } catch (err) {
      console.error('Failed to fetch zones', err);
    }
  };

  const fetchPlaces = async () => {
    try {
      const res = await axios.get('/api/places');
      setPlaces(res.data);
    } catch (err) {
      console.error('Failed to fetch places', err);
    }
  };

  useEffect(() => {
    fetchZones();
    fetchPlaces();
    // Poll for updates every 10 seconds
    const interval = setInterval(() => {
      fetchZones();
      fetchPlaces();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Geolocation tracking
  useEffect(() => {
    if ('geolocation' in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setUserPos({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading
          });
        },
        (err) => console.error('Geolocation error', err),
        { 
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 5000
        }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  useEffect(() => {
    if (userPos && zones.length > 0) {
      const warningZones = zones.filter(z => z.color === 'red' || z.color === 'yellow');
      const currentZone = warningZones.find(z => isPointInPolygon([userPos.lat, userPos.lng], z.points));
      if (currentZone) {
        setActiveWarning(currentZone);
      } else {
        setActiveWarning(null);
      }
    } else {
      setActiveWarning(null);
    }
  }, [userPos, zones]);

  // Auth check
  useEffect(() => {
    if (token) {
      setIsAdmin(true);
    }
  }, [token]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post('/api/login', { password });
      setToken(res.data.token);
      localStorage.setItem('adminToken', res.data.token);
      setIsAdmin(true);
      setShowLogin(false);
      setPassword('');
      setLoginError('');
    } catch (err) {
      setLoginError('Mot de passe incorrect');
    }
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('adminToken');
    setIsAdmin(false);
  };

  const startDrawing = () => {
    setIsDrawing(true);
    setEditingZoneId(null);
    setNewZonePoints([]);
    setNewZoneName(`Zone ${zones.length + 1}`);
  };

  const startEditing = (zone: Zone) => {
    setIsDrawing(true);
    setEditingZoneId(zone.id);
    setNewZonePoints([...zone.points]);
    setNewZoneColor(zone.color);
    setNewZoneName(zone.name);
  };

  const addPoint = (lat: number, lng: number) => {
    if (isDrawing) {
      setNewZonePoints([...newZonePoints, [lat, lng]]);
    } else if (isAddingPlace) {
      setNewPlacePos([lat, lng]);
    }
  };

  const savePlace = async () => {
    if (!newPlacePos || !newPlaceName) return;
    try {
      const placeData = {
        name: newPlaceName,
        lat: newPlacePos[0],
        lng: newPlacePos[1]
      };
      await axios.post('/api/places', placeData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchPlaces();
      setIsAddingPlace(false);
      setNewPlacePos(null);
      setNewPlaceName('');
    } catch (err) {
      console.error('Failed to save place', err);
    }
  };

  const deletePlace = async (id: string) => {
    try {
      await axios.delete(`/api/places/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchPlaces();
    } catch (err) {
      console.error('Failed to delete place', err);
    }
  };

  const updatePoint = (idx: number, lat: number, lng: number) => {
    const updated = [...newZonePoints];
    updated[idx] = [lat, lng];
    setNewZonePoints(updated);
  };

  const saveZone = async () => {
    if (newZonePoints.length < 3) {
      alert('Un polygone doit avoir au moins 3 points');
      return;
    }
    try {
      if (editingZoneId) {
        await axios.put(`/api/zones/${editingZoneId}`, {
          name: newZoneName,
          color: newZoneColor,
          points: newZonePoints
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } else {
        await axios.post('/api/zones', {
          name: newZoneName,
          color: newZoneColor,
          points: newZonePoints
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      setIsDrawing(false);
      setEditingZoneId(null);
      setNewZonePoints([]);
      fetchZones();
    } catch (err) {
      console.error('Failed to save zone', err);
    }
  };

  const deleteZone = async (id: string) => {
    if (!confirm('Supprimer cette zone ?')) return;
    try {
      await axios.delete(`/api/zones/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchZones();
    } catch (err) {
      console.error('Failed to delete zone', err);
    }
  };

  const exportZones = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(zones, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "zones.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const importZones = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        await axios.post('/api/zones/import', importedData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        fetchZones();
        alert('Importation réussie !');
      } catch (err) {
        console.error('Failed to import zones', err);
        alert('Erreur lors de l\'importation. Vérifiez le format du fichier.');
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  return (
    <div className="relative h-screen w-screen bg-gray-100 font-sans overflow-hidden">
      {/* Map Container */}
      <div className="absolute inset-0 z-0">
        <MapContainer center={[48.8566, 2.3522]} zoom={18} scrollWheelZoom={true}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {/* User Position */}
          {userPos && (
            <>
              <ChangeView center={[userPos.lat, userPos.lng]} shouldCenter={shouldCenter} />
              <Marker position={[userPos.lat, userPos.lng]} icon={createUserIcon(userPos.heading, !!activeWarning)} />
            </>
          )}

          {/* Existing Zones */}
          {zones.map((zone) => (
            <Polygon
              key={zone.id}
              positions={zone.points}
              pathOptions={{
                fillColor: zone.color === 'red' ? '#ef4444' : zone.color === 'green' ? '#22c55e' : '#facc15',
                color: zone.color === 'red' ? '#b91c1c' : zone.color === 'green' ? '#15803d' : '#a16207',
                fillOpacity: 0.4
              }}
            >
            </Polygon>
          ))}

          {/* Existing Places */}
          {places.map((place) => (
            <Marker 
              key={place.id} 
              position={[place.lat, place.lng]}
              icon={L.divIcon({
                className: 'place-marker',
                html: `
                  <div class="flex flex-col items-center">
                    <div class="bg-indigo-600 p-2 rounded-full shadow-lg border-2 border-white">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                    </div>
                  </div>
                `,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
              })}
            >
              <Tooltip permanent direction="top" offset={[0, -14]} className="place-tooltip">
                <span className="font-bold text-xs text-indigo-700 px-1">{place.name}</span>
              </Tooltip>
            </Marker>
          ))}

          {/* New Place Preview */}
          {isAddingPlace && newPlacePos && (
            <Marker position={newPlacePos} icon={L.divIcon({
              className: 'place-marker-preview',
              html: `
                <div class="bg-indigo-400 p-2 rounded-full shadow-lg border-2 border-white animate-bounce">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                </div>
              `,
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            })} />
          )}

          {/* New Zone Preview */}
          {isDrawing && newZonePoints.length > 0 && (
            <>
              <Polygon
                positions={newZonePoints}
                pathOptions={{
                  fillColor: newZoneColor === 'red' ? '#ef4444' : newZoneColor === 'green' ? '#22c55e' : '#facc15',
                  color: newZoneColor === 'red' ? '#b91c1c' : newZoneColor === 'green' ? '#15803d' : '#a16207',
                  fillOpacity: 0.6,
                  dashArray: '5, 5'
                }}
              />
              {newZonePoints.map((point, idx) => (
                <Marker
                  key={idx}
                  position={point}
                  draggable={true}
                  icon={createPointIcon(newZoneColor === 'red' ? '#ef4444' : newZoneColor === 'green' ? '#22c55e' : '#facc15')}
                  eventHandlers={{
                    dragend: (e) => {
                      const marker = e.target;
                      const position = marker.getLatLng();
                      updatePoint(idx, position.lat, position.lng);
                    },
                  }}
                />
              ))}
            </>
          )}

          <MapEventsHandler 
            onMapClick={addPoint} 
            isDrawing={isDrawing} 
            isAddingPlace={isAddingPlace}
            onUserInteraction={() => setShouldCenter(false)}
          />
        </MapContainer>
      </div>

      {/* UI Overlays */}
      
      {/* Warning Notification */}
      <AnimatePresence>
        {activeWarning && (
          <motion.div
            initial={{ y: -100, opacity: 0, x: '-50%' }}
            animate={{ y: 60, opacity: 1, x: '-50%' }}
            exit={{ y: -100, opacity: 0, x: '-50%' }}
            className="absolute top-0 left-1/2 z-50 w-full max-w-md px-4 pointer-events-none"
          >
            <div className={`${activeWarning.color === 'red' ? 'bg-red-600 border-red-400/50' : 'bg-yellow-500 border-yellow-300/50'} text-white p-4 rounded-2xl shadow-2xl flex items-center gap-4 border-2 backdrop-blur-md`}>
              <div className="bg-white/20 p-2 rounded-xl">
                <AlertTriangle className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <p className="font-bold text-sm">
                  {activeWarning.color === 'red' ? 'Alerte Zone Rouge !' : 'Alerte Zone Jaune !'}
                </p>
                <p className="text-xs opacity-90">
                  Vous êtes dans la zone <span className="font-black underline">"{activeWarning.name}"</span>. 
                  Il faut revenir dans une zone verte.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Login Modal */}
      <AnimatePresence>
        {showLogin && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md relative"
            >
              <button
                onClick={() => setShowLogin(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
              
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Settings className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800">Accès Admin</h2>
                <p className="text-gray-500 text-sm mt-2">Veuillez entrer votre mot de passe pour gérer les zones.</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="••••••••"
                    autoFocus
                  />
                  {loginError && <p className="text-red-500 text-xs mt-1">{loginError}</p>}
                </div>
                <button
                  type="submit"
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all active:scale-[0.98]"
                >
                  Se connecter
                </button>
              </form>
              <p className="text-center text-[10px] text-gray-400 mt-6 italic">
                Astuce: Le mot de passe par défaut est "admin"
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Controls (Bottom Right) */}
      <div className="absolute bottom-24 right-6 z-10 flex flex-col gap-2 items-end pointer-events-none">
        <div className="flex flex-col gap-2 pointer-events-auto items-end">
          {!isAdmin ? (
            <button
              onClick={() => setShowLogin(true)}
              className="bg-white/90 backdrop-blur-md p-4 rounded-full shadow-lg hover:bg-white transition-colors text-gray-700"
              title="Admin Login"
            >
              <Settings className="w-6 h-6" />
            </button>
          ) : (
            <div className="flex flex-col gap-2 items-end">
              <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-white/20 w-64">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                    <Settings className="w-4 h-4" /> Panel Admin
                  </h2>
                  <button
                    onClick={handleLogout}
                    className="text-red-500 hover:text-red-700 transition-colors"
                    title="Logout"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
                
                {!isDrawing && !isAddingPlace ? (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={startDrawing}
                      className="w-full bg-blue-600 text-white py-2 px-4 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors text-xs"
                    >
                      <Plus className="w-4 h-4" /> Créer une zone
                    </button>
                    <button
                      onClick={() => {
                        setIsAddingPlace(true);
                        setNewPlaceName(`Lieu ${places.length + 1}`);
                        setNewPlacePos(null);
                      }}
                      className="w-full bg-indigo-600 text-white py-2 px-4 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors text-xs"
                    >
                      <MapPin className="w-4 h-4" /> Ajouter un lieu
                    </button>
                  </div>
                ) : isDrawing ? (
                  <div className="space-y-3">
                    <h3 className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                      {editingZoneId ? 'Édition' : 'Création'}
                    </h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setNewZoneColor('red')}
                        className={`flex-1 py-1 rounded-lg text-[10px] font-bold border-2 transition-all ${newZoneColor === 'red' ? 'bg-red-500 border-red-700 text-white' : 'bg-red-100 border-transparent text-red-700'}`}
                      >
                        ROUGE
                      </button>
                      <button
                        onClick={() => setNewZoneColor('yellow')}
                        className={`flex-1 py-1 rounded-lg text-[10px] font-bold border-2 transition-all ${newZoneColor === 'yellow' ? 'bg-yellow-400 border-yellow-600 text-white' : 'bg-yellow-100 border-transparent text-yellow-700'}`}
                      >
                        JAUNE
                      </button>
                      <button
                        onClick={() => setNewZoneColor('green')}
                        className={`flex-1 py-1 rounded-lg text-[10px] font-bold border-2 transition-all ${newZoneColor === 'green' ? 'bg-green-500 border-green-700 text-white' : 'bg-green-100 border-transparent text-green-700'}`}
                      >
                        VERT
                      </button>
                    </div>
                    <input
                      type="text"
                      value={newZoneName}
                      onChange={(e) => setNewZoneName(e.target.value)}
                      placeholder="Nom de la zone"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveZone}
                        disabled={newZonePoints.length < 3}
                        className="flex-1 bg-green-600 text-white py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-green-700 disabled:opacity-50"
                      >
                        <Save className="w-3 h-3" /> Sauver
                      </button>
                      <button
                        onClick={() => setIsDrawing(false)}
                        className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-gray-300"
                      >
                        <X className="w-3 h-3" /> Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <h3 className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                      Nouveau Lieu
                    </h3>
                    <p className="text-[10px] text-gray-500 italic">Cliquez sur la carte pour placer le lieu</p>
                    <input
                      type="text"
                      value={newPlaceName}
                      onChange={(e) => setNewPlaceName(e.target.value)}
                      placeholder="Nom du lieu"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={savePlace}
                        disabled={!newPlacePos || !newPlaceName}
                        className="flex-1 bg-green-600 text-white py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-green-700 disabled:opacity-50"
                      >
                        <Save className="w-3 h-3" /> Sauver
                      </button>
                      <button
                        onClick={() => setIsAddingPlace(false)}
                        className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-gray-300"
                      >
                        <X className="w-3 h-3" /> Annuler
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-4 border-t pt-4">
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={exportZones}
                      className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-[9px] font-bold flex items-center justify-center gap-1 hover:bg-gray-200"
                    >
                      <Download className="w-3 h-3" /> EXPORT
                    </button>
                    <label className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-[9px] font-bold flex items-center justify-center gap-1 hover:bg-gray-200 cursor-pointer">
                      <Upload className="w-3 h-3" /> IMPORT
                      <input type="file" accept=".json" onChange={importZones} className="hidden" />
                    </label>
                  </div>

                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Lieux</h3>
                  <div className="max-h-32 overflow-y-auto space-y-2 pr-1 custom-scrollbar mb-4">
                    {places.map(p => (
                      <div key={p.id} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-100 group">
                        <div className="flex items-center gap-2 overflow-hidden cursor-pointer flex-1">
                          <MapPin className="w-3 h-3 text-indigo-500 shrink-0" />
                          <span className="text-[10px] font-medium text-gray-700 truncate">{p.name}</span>
                        </div>
                        <button onClick={() => deletePlace(p.id)} className="text-gray-400 hover:text-red-500 p-1">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Zones</h3>
                  <div className="max-h-32 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {zones.map(z => (
                      <div key={z.id} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-100 group">
                        <div className="flex items-center gap-2 overflow-hidden cursor-pointer flex-1" onClick={() => startEditing(z)}>
                          <div className={`w-2 h-2 rounded-full shrink-0 ${z.color === 'red' ? 'bg-red-500' : z.color === 'green' ? 'bg-green-500' : 'bg-yellow-400'}`} />
                          <span className="text-[10px] font-medium text-gray-700 truncate group-hover:text-blue-600">{z.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => startEditing(z)} className="text-gray-400 hover:text-blue-500 p-1">
                            <Settings className="w-3 h-3" />
                          </button>
                          <button onClick={() => deleteZone(z.id)} className="text-gray-400 hover:text-red-500 p-1">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Action Button for Location (Mobile) */}
      <button
        onClick={() => {
          if (userPos) {
            setShouldCenter(true);
          }
        }}
        className={`absolute bottom-6 right-6 z-10 p-4 rounded-full shadow-2xl transition-all active:scale-90 pointer-events-auto ${shouldCenter ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 hover:bg-blue-50'}`}
        title="Recentrer sur ma position"
      >
        <MapPin className="w-6 h-6" />
      </button>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
}
