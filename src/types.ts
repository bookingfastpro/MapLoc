export interface Zone {
  id: string;
  name: string;
  color: 'red' | 'green';
  points: [number, number][]; // [lat, lng]
}

export interface UserPosition {
  lat: number;
  lng: number;
  accuracy: number;
}
