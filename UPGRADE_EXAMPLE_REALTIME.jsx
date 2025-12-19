// 🚀 PRZYKŁAD IMPLEMENTACJI: Real-time Dashboard Updates
// To jest przykład jak można dodać real-time updates do AdminPanel

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

// Hook do real-time updates
export function useRealtimeMetrics() {
  const [metrics, setMetrics] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    activeUsers: 0,
    currentHourOrders: 0
  });
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Połączenie WebSocket (można też użyć SSE)
    const socket = io(`${process.env.REACT_APP_WS_URL || 'ws://localhost:3000'}/admin/dashboard`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      setIsConnected(true);
      console.log('✅ Connected to real-time dashboard');
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log('❌ Disconnected from real-time dashboard');
    });

    // Aktualizacja metryk w czasie rzeczywistym
    socket.on('metrics:update', (data) => {
      setMetrics(prev => ({
        ...prev,
        ...data
      }));
    });

    // Nowe zamówienie
    socket.on('order:new', (order) => {
      setMetrics(prev => ({
        ...prev,
        totalOrders: prev.totalOrders + 1,
        totalRevenue: prev.totalRevenue + (order.total || 0),
        currentHourOrders: prev.currentHourOrders + 1
      }));
      
      // Opcjonalnie: pokaż notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Nowe zamówienie!', {
          body: `Wartość: ${order.total} zł`,
          icon: '/icon.png'
        });
      }
    });

    // Aktualizacja aktywnych użytkowników
    socket.on('users:active', (count) => {
      setMetrics(prev => ({
        ...prev,
        activeUsers: count
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return { metrics, isConnected };
}

// Komponent statusu połączenia
export function ConnectionStatus({ isConnected }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
      isConnected 
        ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
        : 'bg-red-500/20 text-red-400 border border-red-500/30'
    }`}>
      <div className={`w-2 h-2 rounded-full ${
        isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'
      }`} />
      <span>{isConnected ? 'Live' : 'Offline'}</span>
    </div>
  );
}

// Komponent live ticker dla przychodu
export function LiveRevenueTicker({ revenue, isConnected }) {
  const [animatedValue, setAnimatedValue] = useState(revenue);

  useEffect(() => {
    if (!isConnected) return;
    
    const diff = revenue - animatedValue;
    const steps = 20;
    const step = diff / steps;
    let current = animatedValue;
    
    const interval = setInterval(() => {
      current += step;
      if (Math.abs(current - revenue) < 0.01) {
        current = revenue;
        clearInterval(interval);
      }
      setAnimatedValue(current);
    }, 50);

    return () => clearInterval(interval);
  }, [revenue, isConnected]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-2xl font-bold text-cyan-400 neon-glow">
        {animatedValue.toLocaleString('pl-PL', { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        })} zł
      </span>
      {isConnected && (
        <span className="text-xs text-green-400 animate-pulse">LIVE</span>
      )}
    </div>
  );
}

// Przykład użycia w AdminPanel:
/*
import { useRealtimeMetrics, ConnectionStatus, LiveRevenueTicker } from './hooks/useRealtimeMetrics';

export default function AdminPanel() {
  const { metrics, isConnected } = useRealtimeMetrics();
  
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Admin Panel</h1>
        <ConnectionStatus isConnected={isConnected} />
      </div>
      
      <div className="grid grid-cols-4 gap-4">
        <div className="galaxy-card">
          <div className="text-sm text-gray-400">Przychód (Live)</div>
          <LiveRevenueTicker 
            revenue={metrics.totalRevenue} 
            isConnected={isConnected} 
          />
        </div>
        
        <div className="galaxy-card">
          <div className="text-sm text-gray-400">Zamówienia</div>
          <div className="text-3xl font-bold text-purple-400">
            {metrics.totalOrders}
          </div>
        </div>
        
        <div className="galaxy-card">
          <div className="text-sm text-gray-400">Aktywni użytkownicy</div>
          <div className="text-3xl font-bold text-pink-400">
            {metrics.activeUsers}
          </div>
        </div>
        
        <div className="galaxy-card">
          <div className="text-sm text-gray-400">Zamówienia (ta godzina)</div>
          <div className="text-3xl font-bold text-cyan-400">
            {metrics.currentHourOrders}
          </div>
        </div>
      </div>
    </div>
  );
}
*/

// Backend endpoint (przykład dla Express):
/*
// server-vercel.js lub osobny plik
import { Server } from 'socket.io';

const io = new Server(server, {
  cors: { origin: '*' }
});

// Emitowanie metryk co 5 sekund
setInterval(() => {
  const metrics = {
    totalOrders: await getTotalOrders(),
    totalRevenue: await getTotalRevenue(),
    activeUsers: await getActiveUsers(),
    currentHourOrders: await getCurrentHourOrders()
  };
  
  io.to('admin-dashboard').emit('metrics:update', metrics);
}, 5000);

// Nasłuchiwanie nowych zamówień
supabase
  .channel('orders')
  .on('postgres_changes', 
    { event: 'INSERT', schema: 'public', table: 'orders' },
    (payload) => {
      io.to('admin-dashboard').emit('order:new', payload.new);
    }
  )
  .subscribe();

// Endpoint do dołączenia do room
io.on('connection', (socket) => {
  socket.on('join:admin-dashboard', () => {
    socket.join('admin-dashboard');
  });
});
*/


