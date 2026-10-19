import type { Metadata } from 'next';
import { LocationPicker } from '@/components/shell/location-picker';

export const metadata: Metadata = { title: 'Change location' };

export default function LocationPage() {
  return <LocationPicker />;
}
