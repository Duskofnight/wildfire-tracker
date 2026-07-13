'use client';
import dynamic from 'next/dynamic';

const FireMap = dynamic(() => import('./components/FireMap'), { ssr: false });

export default function Home() {
  return <FireMap />;
}