export interface Zone {
  id: string;
  name: string;
  color: 'red' | 'green' | 'yellow';
  points: [number, number][]; // [lat, lng]
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  stopRadius?: number; // in meters
}

export interface TimerHistoryEntry {
  id: string;
  startTime: number;
  endTime: number;
  duration: number; // actual elapsed time in ms
  initialCountdown: number; // initial set time in ms
}

export interface UserPosition {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
}
