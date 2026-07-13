import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CACHE_MINUTES = 60;

export async function GET() {
  const { data: cached } = await supabase
    .from('fire_snapshots')
    .select('*')
    .eq('region', 'world')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .single();

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_MINUTES * 60 * 1000) {
    return NextResponse.json(cached.data);
  }

  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${process.env.FIRMS_MAP_KEY}/VIIRS_NOAA20_NRT/world/2`;

  const res = await fetch(url);
  const csv = await res.text();
  const rows = csv.trim().split('\n');
  const headers = rows[0].split(',');
  const fires = rows.slice(1).map(row => {
  const values = row.split(',');
  return headers.reduce((obj, key, i) => {
    obj[key] = values[i];
    return obj;
  }, {} as Record<string, string>);
});

// drop low-confidence noise and weak/tiny detections — cuts payload size a lot
const filtered = fires.filter(f => f.confidence !== 'l' && parseFloat(f.frp) > 1);

await supabase.from('fire_snapshots').insert({ region: 'world', data: filtered });
return NextResponse.json(filtered);

}