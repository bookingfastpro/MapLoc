import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Polygon, Marker, CircleMarker, useMap, useMapEvents, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { Zone, UserPosition, Place, TimerHistoryEntry } from './types';
import { MapPin, Navigation, Plus, Trash2, Save, X, LogOut, Settings, Download, Upload, ChevronDown, ChevronUp, Phone, Timer, Play, RotateCcw, History } from 'lucide-react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

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
  const arrowColor = isWarning ? '#f97316' : '#3b82f6';
  
  return L.divIcon({
    className: 'user-marker-container',
    html: `
      <div class="user-marker ${warningClass}">
        <div class="user-marker-pulse"></div>
        <div class="user-marker-heading" style="${rotation}">
          <div class="user-marker-arrow">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z" fill="${arrowColor}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
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
      const targetZoom = currentZoom < 17 ? 17 : currentZoom;
      
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
  const [isAdminPanelCollapsed, setIsAdminPanelCollapsed] = useState(false);

  // Timer state (Countdown)
  const [timerRunning, setTimerRunning] = useState(() => localStorage.getItem('timerRunning') === 'true');
  const [timerStartTime, setTimerStartTime] = useState(() => Number(localStorage.getItem('timerStartTime')) || 0);
  const [sessionStartTime, setSessionStartTime] = useState(() => Number(localStorage.getItem('sessionStartTime')) || 0);
  const [timerAccumulated, setTimerAccumulated] = useState(() => Number(localStorage.getItem('timerAccumulated')) || 0);
  const [totalCountdownTime, setTotalCountdownTime] = useState(() => Number(localStorage.getItem('totalCountdownTime')) || 30 * 60 * 1000);
  const [remainingTime, setRemainingTime] = useState(0);

  // Timer History state
  const [timerHistory, setTimerHistory] = useState<TimerHistoryEntry[]>(() => {
    const saved = localStorage.getItem('timerHistory');
    return saved ? JSON.parse(saved) : [];
  });
  const [showHistory, setShowHistory] = useState(false);
  const [showTimeEditor, setShowTimeEditor] = useState(false);
  const [editHours, setEditHours] = useState('0');
  const [editMinutes, setEditMinutes] = useState('30');
  const [hasShown15MinAlert, setHasShown15MinAlert] = useState(false);

  // Update remaining time every second
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (timerRunning && timerStartTime > 0) {
      interval = setInterval(() => {
        const elapsed = timerAccumulated + (Date.now() - timerStartTime);
        const remaining = totalCountdownTime - elapsed;
        setRemainingTime(remaining);
      }, 100);
    } else {
      const remaining = totalCountdownTime - timerAccumulated;
      setRemainingTime(remaining);
    }
    return () => clearInterval(interval);
  }, [timerRunning, timerStartTime, timerAccumulated, totalCountdownTime]);

  useEffect(() => {
    if (timerRunning && remainingTime <= 15 * 60 * 1000 && remainingTime > 14 * 60 * 1000 && !hasShown15MinAlert) {
      showAlert('Attention', "Il ne reste que 15 minutes pour arriver au point de départ, il faut vite rentrer !");
      setHasShown15MinAlert(true);
      if ("vibrate" in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }
    }
    // Reset alert if time is added back
    if (remainingTime > 15 * 60 * 1000 && hasShown15MinAlert) {
      setHasShown15MinAlert(false);
    }
  }, [remainingTime, timerRunning, hasShown15MinAlert]);

  // Persist timer state
  useEffect(() => {
    localStorage.setItem('timerRunning', String(timerRunning));
    localStorage.setItem('timerStartTime', String(timerStartTime));
    localStorage.setItem('sessionStartTime', String(sessionStartTime));
    localStorage.setItem('timerAccumulated', String(timerAccumulated));
    localStorage.setItem('totalCountdownTime', String(totalCountdownTime));
    localStorage.setItem('timerHistory', JSON.stringify(timerHistory));
  }, [timerRunning, timerStartTime, sessionStartTime, timerAccumulated, totalCountdownTime, timerHistory]);

  const startTimer = () => {
    const now = Date.now();
    if (sessionStartTime === 0) {
      setSessionStartTime(now);
    }
    setTimerStartTime(now);
    setTimerRunning(true);
  };

  const pauseTimer = () => {
    if (!timerRunning) return;
    const now = Date.now();
    if (timerStartTime > 0) {
      setTimerAccumulated(prev => prev + (now - timerStartTime));
    }
    setTimerRunning(false);
    setTimerStartTime(0);
  };

  const resetTimer = () => {
    if (timerAccumulated > 0 || timerRunning) {
      const entry: TimerHistoryEntry = {
        id: uuidv4(),
        startTime: sessionStartTime || Date.now(),
        endTime: Date.now(),
        duration: (timerRunning && timerStartTime > 0) 
          ? timerAccumulated + (Date.now() - timerStartTime) 
          : timerAccumulated,
        initialCountdown: totalCountdownTime
      };
      setTimerHistory(prev => [entry, ...prev].slice(0, 50)); // Keep last 50
    }
    setTimerRunning(false);
    setTimerStartTime(0);
    setSessionStartTime(0);
    setTimerAccumulated(0);
    setRemainingTime(totalCountdownTime);
    setHasShown15MinAlert(false);
  };

  const addTime = (minutes: number) => {
    const msToAdd = minutes * 60 * 1000;
    setTotalCountdownTime(prev => prev + msToAdd);
  };

  const removeTime = (minutes: number) => {
    const msToRemove = minutes * 60 * 1000;
    setTotalCountdownTime(prev => Math.max(0, prev - msToRemove));
    // If we remove more time than already elapsed, we might need to adjust accumulated
    // But for simplicity, let's just adjust the total.
  };

  const formatTime = (ms: number) => {
    const isNegative = ms < 0;
    const absMs = Math.abs(ms);
    const totalSeconds = Math.ceil(absMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    return isNegative ? `-${timeStr}` : timeStr;
  };

  const formatStartTime = (timestamp: number) => {
    if (timestamp === 0) return '--:--';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const handleTimeEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const hrs = parseInt(editHours) || 0;
    const mins = parseInt(editMinutes) || 0;
    if (hrs >= 0 && mins >= 0 && (hrs > 0 || mins > 0)) {
      setTotalCountdownTime((hrs * 60 + mins) * 60 * 1000);
      setTimerAccumulated(0);
      setTimerStartTime(0);
      setSessionStartTime(0);
      setTimerRunning(false);
      setShowTimeEditor(false);
    }
  };

  // Modal state
  const [modal, setModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm?: () => void;
    type: 'alert' | 'confirm';
  }>({ show: false, title: '', message: '', type: 'alert' });

  const showAlert = (title: string, message: string) => {
    setModal({ show: true, title, message, type: 'alert' });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModal({ show: true, title, message, onConfirm, type: 'confirm' });
  };

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [newZonePoints, setNewZonePoints] = useState<[number, number][]>([]);
  const [newZoneColor, setNewZoneColor] = useState<'red' | 'green' | 'yellow'>('red');
  const [newZoneName, setNewZoneName] = useState('');

  // Place state
  const [isAddingPlace, setIsAddingPlace] = useState(false);
  const [newPlaceName, setNewPlaceName] = useState('');
  const [newPlaceStopRadius, setNewPlaceStopRadius] = useState<number>(0);
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

    // Stop timer if in a place stop radius
    if (userPos && timerRunning && places.length > 0) {
      const stopPlace = places.find(p => {
        if (!p.stopRadius || p.stopRadius <= 0) return false;
        const dist = L.latLng(userPos.lat, userPos.lng).distanceTo(L.latLng(p.lat, p.lng));
        return dist <= p.stopRadius;
      });

      if (stopPlace) {
        pauseTimer();
        showAlert('Timer Arrêté', `Vous êtes entré dans la zone de ${stopPlace.name}. Le compte à rebours a été mis en pause.`);
      }
    }
  }, [userPos, zones, places, timerRunning]);

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
        lng: newPlacePos[1],
        stopRadius: newPlaceStopRadius
      };
      await axios.post('/api/places', placeData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchPlaces();
      setIsAddingPlace(false);
      setNewPlacePos(null);
      setNewPlaceName('');
      setNewPlaceStopRadius(0);
    } catch (err) {
      console.error('Failed to save place', err);
    }
  };

  const deletePlace = async (id: string) => {
    showConfirm('Supprimer le lieu', 'Êtes-vous sûr de vouloir supprimer ce lieu ?', async () => {
      try {
        await axios.delete(`/api/places/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        fetchPlaces();
      } catch (err) {
        console.error('Failed to delete place', err);
      }
    });
  };

  const updatePoint = (idx: number, lat: number, lng: number) => {
    const updated = [...newZonePoints];
    updated[idx] = [lat, lng];
    setNewZonePoints(updated);
  };

  const saveZone = async () => {
    if (newZonePoints.length < 3) {
      showAlert('Erreur', 'Un polygone doit avoir au moins 3 points');
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
    showConfirm('Supprimer la zone', 'Êtes-vous sûr de vouloir supprimer cette zone ?', async () => {
      try {
        await axios.delete(`/api/zones/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        fetchZones();
      } catch (err) {
        console.error('Failed to delete zone', err);
      }
    });
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
        showAlert('Succès', 'Importation réussie !');
      } catch (err) {
        console.error('Failed to import zones', err);
        showAlert('Erreur', 'Erreur lors de l\'importation. Vérifiez le format du fichier.');
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  return (
    <div className="relative h-[100dvh] w-full bg-gray-100 font-sans overflow-hidden">
      {/* Map Container */}
      <div className="absolute inset-0 z-0">
        <MapContainer center={[48.8566, 2.3522]} zoom={17} scrollWheelZoom={true} zoomControl={false} attributionControl={false}>
          <TileLayer
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
            <React.Fragment key={place.id}>
              <Marker 
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
                  <div className="flex flex-col items-center">
                    <span className="font-bold text-xs text-indigo-700 px-1">{place.name}</span>
                    {place.stopRadius && place.stopRadius > 0 && (
                      <span className="text-[8px] text-gray-500 italic">Arrêt: {place.stopRadius}m</span>
                    )}
                  </div>
                </Tooltip>
              </Marker>
              {place.stopRadius && place.stopRadius > 0 && (
                <CircleMarker
                  center={[place.lat, place.lng]}
                  radius={place.stopRadius}
                  pathOptions={{
                    color: '#4f46e5',
                    fillColor: '#4f46e5',
                    fillOpacity: 0.1,
                    dashArray: '5, 10',
                    weight: 1
                  }}
                />
              )}
            </React.Fragment>
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
            animate={{ y: 16, opacity: 1, x: '-50%' }}
            exit={{ y: -100, opacity: 0, x: '-50%' }}
            transition={{ type: 'spring', damping: 20, stiffness: 120 }}
            className="absolute top-0 left-1/2 z-50 w-full max-w-sm px-4 pointer-events-none"
          >
            <div className={`
              relative overflow-hidden
              ${activeWarning.color === 'red' 
                ? 'bg-red-600/90 border-red-400/30 shadow-[0_8px_32px_rgba(220,38,38,0.4)]' 
                : 'bg-amber-500/90 border-amber-300/30 shadow-[0_8px_32px_rgba(245,158,11,0.4)]'
              } 
              text-white p-3.5 rounded-[20px] flex items-center gap-3.5 border backdrop-blur-xl
            `}>
              {/* Subtle inner glow */}
              <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none" />
              
              <div className="bg-white/20 p-2 rounded-xl shadow-inner shrink-0">
                <AlertTriangle className="w-5 h-5 animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-xs tracking-tight uppercase mb-0.5">
                  {activeWarning.color === 'red' ? 'Zone de Danger' : 'Zone de Vigilance'}
                </p>
                <p className="text-[11px] leading-tight opacity-90 font-medium truncate">
                  Vous êtes dans <span className="font-bold underline">"{activeWarning.name}"</span>. 
                  Rejoignez une zone sûre.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Modal (Alert/Confirm) */}
      <AnimatePresence>
        {modal.show && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white p-6 rounded-3xl shadow-2xl w-full max-w-sm"
            >
              <h3 className="text-xl font-bold text-gray-800 mb-2">{modal.title}</h3>
              <p className="text-gray-600 text-sm mb-6">{modal.message}</p>
              
              <div className="flex gap-3">
                {modal.type === 'confirm' && (
                  <button
                    onClick={() => setModal({ ...modal, show: false })}
                    className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-200 transition-all"
                  >
                    Annuler
                  </button>
                )}
                <button
                  onClick={() => {
                    if (modal.type === 'confirm' && modal.onConfirm) {
                      modal.onConfirm();
                    }
                    setModal({ ...modal, show: false });
                  }}
                  className={`flex-1 ${modal.type === 'confirm' ? 'bg-red-600' : 'bg-blue-600'} text-white py-3 rounded-xl font-bold shadow-lg hover:opacity-90 transition-all`}
                >
                  {modal.type === 'confirm' ? 'Supprimer' : 'OK'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Countdown Timer (Bottom Center) */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none w-full max-w-[350px] px-2 flex flex-col items-center gap-2">
        {/* Timer Display Row (Separated) */}
        <div 
          className={`flex flex-col items-center cursor-pointer px-6 py-2 rounded-xl transition-all duration-500 shadow-2xl pointer-events-auto border ${
            remainingTime <= 0 
              ? 'bg-red-600 border-red-400 animate-pulse scale-110' 
              : remainingTime <= 15 * 60 * 1000 
                ? 'bg-amber-500 border-amber-300' 
                : 'bg-gray-900 border-white/10 hover:bg-black'
          }`}
          onClick={() => {
            const totalMins = Math.floor(totalCountdownTime / 60000);
            setEditHours(Math.floor(totalMins / 60).toString());
            setEditMinutes((totalMins % 60).toString());
            setShowTimeEditor(true);
          }}
          title="Cliquer pour éditer le temps"
        >
          <span className={`text-xl font-mono font-bold tabular-nums leading-none ${
            remainingTime <= 0 || remainingTime <= 15 * 60 * 1000
              ? 'text-white' 
              : 'text-white'
          }`}>
            {formatTime(remainingTime)}
          </span>
        </div>

        {/* Buttons Block */}
        <div className="bg-white px-4 py-3 rounded-2xl shadow-2xl border border-gray-100 flex flex-col items-center gap-3 pointer-events-auto cursor-default">
          {/* Buttons Row */}
          <div className="flex items-center justify-center w-full gap-1.5">
            <a
              href="tel:+33970703989"
              className="p-2.5 bg-green-600 text-white rounded-full hover:bg-green-700 transition-colors shadow-sm active:scale-90 flex items-center justify-center"
              title="Appeler le support"
            >
              <Phone className="w-4 h-4" />
            </a>
            <button
              onClick={() => {
                if (userPos) {
                  setShouldCenter(true);
                  if ("vibrate" in navigator) {
                    navigator.vibrate(50);
                  }
                }
              }}
              className={`p-2.5 rounded-full shadow-sm transition-all active:scale-90 flex items-center justify-center ${shouldCenter ? 'bg-blue-600 text-white' : 'bg-gray-100 text-blue-600 hover:bg-gray-200'}`}
              title="Recentrer"
            >
              <MapPin className="w-4 h-4" />
            </button>
            <div className="w-[1px] h-5 bg-gray-200 mx-0.5 self-center" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!timerRunning) {
                  startTimer();
                  if ("vibrate" in navigator) navigator.vibrate(50);
                }
              }}
              disabled={timerRunning}
              className={`p-2.5 rounded-full shadow-md transition-all flex items-center justify-center ${
                timerRunning 
                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed' 
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-90'
              }`}
              title={timerRunning ? "Timer en cours" : "Démarrer"}
            >
              <Play className="w-4 h-4 fill-current" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                resetTimer();
                if ("vibrate" in navigator) navigator.vibrate(50);
              }}
              className="p-2.5 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors shadow-sm active:scale-90 flex items-center justify-center"
              title="Réinitialiser"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowHistory(true);
              }}
              className="p-2.5 bg-gray-50 text-gray-400 rounded-full hover:bg-gray-100 transition-colors shadow-sm active:scale-90 flex items-center justify-center"
              title="Historique"
            >
              <History className="w-4 h-4" />
            </button>
          </div>

          {sessionStartTime > 0 && (
            <div className="flex items-center gap-1 w-full justify-center border-t border-gray-50 pt-1">
              <span className="text-[7px] text-gray-400 font-medium">Départ:</span>
              <span className="text-[7px] font-bold text-gray-600">{formatStartTime(sessionStartTime)}</span>
            </div>
          )}
        </div>
      </div>

      {/* History Modal */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-blue-600" />
                  <h2 className="text-xl font-bold text-gray-800">Historique</h2>
                </div>
                <button
                  onClick={() => setShowHistory(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {timerHistory.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <History className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>Aucun historique disponible</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {timerHistory.map((entry) => (
                      <div key={entry.id} className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            {new Date(entry.startTime).toLocaleDateString('fr-FR')}
                          </span>
                          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                            Initial: {formatTime(entry.initialCountdown)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="flex flex-col">
                            <span className="text-xs text-gray-500">Départ: {formatStartTime(entry.startTime)}</span>
                            <span className="text-xs text-gray-500">Fin: {formatStartTime(entry.endTime)}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-mono font-bold text-gray-800">
                              {formatTime(entry.duration)}
                            </span>
                            <p className="text-[9px] text-gray-400 uppercase font-bold">Écoulé</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 border-t">
                <button
                  onClick={() => setShowHistory(false)}
                  className="w-full py-3 bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 rounded-xl transition-colors text-sm"
                >
                  Fermer
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Time Editor Modal */}
      <AnimatePresence>
        {showTimeEditor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white p-6 rounded-3xl shadow-2xl w-full max-w-xs"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-800">Éditer le temps</h3>
                <button onClick={() => setShowTimeEditor(false)} className="text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleTimeEditSubmit} className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 text-center">Heures</label>
                    <input
                      type="number"
                      min="0"
                      value={editHours}
                      onChange={(e) => setEditHours(e.target.value)}
                      className="w-full px-2 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl font-mono font-bold"
                      autoFocus
                    />
                  </div>
                  <div className="flex items-end pb-3 text-2xl font-bold text-gray-300">:</div>
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 text-center">Minutes</label>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={editMinutes}
                      onChange={(e) => setEditMinutes(e.target.value)}
                      className="w-full px-2 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl font-mono font-bold"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTimeEditor(false)}
                    className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-lg"
                  >
                    Valider
                  </button>
                </div>
              </form>
            </motion.div>
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

      {/* Controls Container (Top Right) */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-4 items-end pointer-events-none max-w-[calc(100vw-2rem)]">
        <div className="flex flex-col gap-4 pointer-events-auto items-end w-full">
          {!isAdmin ? (
            <button
              onClick={() => setShowLogin(true)}
              className="bg-white/90 backdrop-blur-md p-3 sm:p-4 rounded-full shadow-lg hover:bg-white transition-colors text-gray-700 active:scale-95"
              title="Admin Login"
            >
              <Settings className="w-5 h-5 sm:w-6 h-6" />
            </button>
          ) : (
            <div className="flex flex-col gap-2 items-end w-full">
              <motion.div 
                animate={{ height: isAdminPanelCollapsed ? '48px' : 'auto' }}
                transition={{ type: 'spring', damping: 20, stiffness: 150 }}
                className="bg-white/90 backdrop-blur-md rounded-2xl shadow-xl border border-white/20 w-full max-w-[260px] overflow-hidden"
              >
                <div className="flex justify-between items-center p-4">
                  <div 
                    className="flex items-center gap-2 cursor-pointer flex-1"
                    onClick={() => setIsAdminPanelCollapsed(!isAdminPanelCollapsed)}
                  >
                    <Settings className="w-4 h-4 text-gray-600" />
                    <h2 className="font-bold text-gray-800 text-sm">Panel Admin</h2>
                    {isAdminPanelCollapsed ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                  <button
                    onClick={handleLogout}
                    className="text-red-500 hover:text-red-700 transition-colors ml-2"
                    title="Logout"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
                
                <AnimatePresence>
                  {!isAdminPanelCollapsed && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="px-4 pb-4"
                    >
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
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-gray-400 uppercase">Rayon d'arrêt (mètres)</label>
                            <input
                              type="number"
                              value={newPlaceStopRadius}
                              onChange={(e) => setNewPlaceStopRadius(Number(e.target.value))}
                              placeholder="Rayon (ex: 50)"
                              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
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
                                <div className="flex flex-col overflow-hidden">
                                  <span className="text-[10px] font-medium text-gray-700 truncate">{p.name}</span>
                                  {p.stopRadius && p.stopRadius > 0 && (
                                    <span className="text-[8px] text-indigo-400 font-bold uppercase">Arrêt: {p.stopRadius}m</span>
                                  )}
                                </div>
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          )}
        </div>
      </div>

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
