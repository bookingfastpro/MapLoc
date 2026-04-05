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
}

export interface UserPosition {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
}
