'use client';

import { useLocation } from '@/lib/state/location';
import { Button } from '@/components/ui/button';

/** Jumps to the demo neighbourhood the sample shops are pinned in. */
export function SampleAreaButton() {
  const { useSampleLocation: pickSampleLocation } = useLocation();
  return (
    <Button type="button" variant="leaf" size="md" onClick={() => pickSampleLocation()}>
      See the Abids sample area
    </Button>
  );
}
