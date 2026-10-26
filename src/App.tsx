import React, { useState, useEffect, useRef, useCallback } from 'react';

interface PlanetData {
  name: string;
  color: string;
  size: number; // display size in px
  orbitRadius: number; // display orbit radius in px
  realDiameter: string; // km
  realDistance: string; // million km
  orbitalPeriod: string; // Earth days/years
  description: string;
  speed: number; // relative orbital speed
  ringColor?: string;
}

const planets: PlanetData[] = [
  {
    name: 'Mercury',
    color: '#b5b5b5',
    size: 8,
    orbitRadius: 60,
    realDiameter: '4,879 km',
    realDistance: '57.9 million km',
    orbitalPeriod: '88 days',
    description: 'The smallest planet and closest to the Sun. It has no atmosphere and extreme temperature variations.',
    speed: 4.15,
  },
  {
    name: 'Venus',
    color: '#e8cda0',
    size: 12,
    orbitRadius: 90,
    realDiameter: '12,104 km',
    realDistance: '108.2 million km',
    orbitalPeriod: '225 days',
    description: 'The hottest planet due to its thick CO₂ atmosphere. It rotates backwards compared to most planets.',
    speed: 1.62,
  },
  {
    name: 'Earth',
    color: '#4da6ff',
    size: 13,
    orbitRadius: 125,
    realDiameter: '12,756 km',
    realDistance: '149.6 million km',
    orbitalPeriod: '365.25 days',
    description: 'Our home planet — the only known world with liquid water on its surface and life.',
    speed: 1.0,
  },
  {
    name: 'Mars',
    color: '#e07050',
    size: 10,
    orbitRadius: 160,
    realDiameter: '6,792 km',
    realDistance: '227.9 million km',
    orbitalPeriod: '687 days',
    description: 'The Red Planet, known for its iron oxide surface. Home to the tallest volcano in the solar system.',
    speed: 0.53,
  },
  {
    name: 'Jupiter',
    color: '#d4a574',
    size: 28,
    orbitRadius: 215,
    realDiameter: '142,984 km',
    realDistance: '778.6 million km',
    orbitalPeriod: '11.86 years',
    description: 'The largest planet — a gas giant with a Great Red Spot storm that has raged for centuries.',
    speed: 0.084,
  },
  {
    name: 'Saturn',
    color: '#f0d8a0',
    size: 24,
    orbitRadius: 275,
    realDiameter: '120,536 km',
    realDistance: '1,433.5 million km',
    orbitalPeriod: '29.46 years',
    description: 'Famous for its stunning ring system made of ice and rock. It could float in water if there were a big enough bathtub!',
    speed: 0.034,
    ringColor: '#c8b070',
  },
  {
    name: 'Uranus',
    color: '#7ec8e3',
    size: 18,
    orbitRadius: 330,
    realDiameter: '51,118 km',
    realDistance: '2,872.5 million km',
    orbitalPeriod: '84.01 years',
    description: 'An ice giant that rotates on its side. It has a blue-green color from methane in its atmosphere.',
    speed: 0.012,
  },
  {
    name: 'Neptune',
    color: '#4060e0',
    size: 17,
    orbitRadius: 380,
    realDiameter: '49,528 km',
    realDistance: '4,495.1 million km',
    orbitalPeriod: '164.8 years',
    description: 'The windiest planet with speeds up to 2,100 km/h. It has a vivid blue color and 14 known moons.',
    speed: 0.006,
  },
];

function App() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [selectedPlanet, setSelectedPlanet] = useState<PlanetData | null>(null);
  const [angles, setAngles] = useState<number[]>(planets.map(() => Math.random() * Math.PI * 2));
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const animate = useCallback((timestamp: number) => {
    if (!lastTimeRef.current) lastTimeRef.current = timestamp;
    const delta = (timestamp - lastTimeRef.current) / 1000;
    lastTimeRef.current = timestamp;

    setAngles(prev => prev.map((angle, i) => angle + planets[i].speed * speed * delta * 0.5));
    animationRef.current = requestAnimationFrame(animate);
  }, [speed]);

  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = 0;
      animationRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, animate]);

  const getPlanetPosition = (index: number) => {
    const planet = planets[index];
    const angle = angles[index];
    const x = Math.cos(angle) * planet.orbitRadius;
    const y = Math.sin(angle) * planet.orbitRadius * 0.4; // elliptical perspective
    return { x, y };
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white overflow-hidden relative">
      {/* Stars background */}
      <div className="absolute inset-0 overflow-hidden">
        {Array.from({ length: 200 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: Math.random() * 2 + 1 + 'px',
              height: Math.random() * 2 + 1 + 'px',
              top: Math.random() * 100 + '%',
              left: Math.random() * 100 + '%',
              opacity: Math.random() * 0.7 + 0.3,
              animation: `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite`,
              animationDelay: Math.random() * 5 + 's',
            }}
          />
        ))}
      </div>

      {/* Header */}
      <header className="relative z-10 text-center pt-6 pb-2">
        <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-yellow-300 via-orange-300 to-yellow-500 bg-clip-text text-transparent">
          🌌 Solar System Explorer
        </h1>
        <p className="text-gray-400 text-sm mt-1">Click on any planet to learn more</p>
      </header>

      {/* Solar System Visualization */}
      <div className="relative z-10 flex items-center justify-center" style={{ height: 'calc(100vh - 200px)' }}>
        <div ref={containerRef} className="relative" style={{ width: '800px', height: '500px' }}>
          {/* Sun */}
          <div
            className="absolute rounded-full cursor-pointer"
            style={{
              width: '50px',
              height: '50px',
              background: 'radial-gradient(circle, #fff7a0, #ffcc00, #ff8800)',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 40px 15px rgba(255, 200, 0, 0.5), 0 0 80px 30px rgba(255, 150, 0, 0.3)',
            }}
          />

          {/* Orbit paths */}
          {planets.map((planet, i) => (
            <div
              key={`orbit-${i}`}
              className="absolute border border-gray-700/40 rounded-full"
              style={{
                width: planet.orbitRadius * 2 + 'px',
                height: planet.orbitRadius * 2 * 0.4 + 'px',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />
          ))}

          {/* Planets */}
          {planets.map((planet, i) => {
            const pos = getPlanetPosition(i);
            const isSelected = selectedPlanet?.name === planet.name;
            return (
              <div
                key={`planet-${i}`}
                className="absolute cursor-pointer transition-transform duration-150 hover:scale-125"
                style={{
                  width: planet.size + 'px',
                  height: planet.size + 'px',
                  left: `calc(50% + ${pos.x}px - ${planet.size / 2}px)`,
                  top: `calc(50% + ${pos.y}px - ${planet.size / 2}px)`,
                  zIndex: pos.y > 0 ? 20 : 5,
                }}
                onClick={() => setSelectedPlanet(isSelected ? null : planet)}
              >
                {/* Planet body */}
                <div
                  className="w-full h-full rounded-full relative"
                  style={{
                    background: `radial-gradient(circle at 35% 35%, ${planet.color}, ${adjustColor(planet.color, -40)})`,
                    boxShadow: isSelected
                      ? `0 0 15px 5px ${planet.color}80, 0 0 30px 10px ${planet.color}40`
                      : `0 0 8px 2px ${planet.color}60`,
                  }}
                >
                  {/* Saturn's ring */}
                  {planet.ringColor && (
                    <div
                      className="absolute border-2 rounded-full"
                      style={{
                        width: planet.size * 2 + 'px',
                        height: planet.size * 0.5 + 'px',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%) rotateX(75deg)',
                        borderColor: planet.ringColor,
                        background: `linear-gradient(to right, transparent 20%, ${planet.ringColor}40 40%, ${planet.ringColor}60 50%, ${planet.ringColor}40 60%, transparent 80%)`,
                      }}
                    />
                  )}
                </div>
                {/* Planet name label */}
                <div
                  className="absolute text-xs text-gray-300 whitespace-nowrap font-medium pointer-events-none"
                  style={{
                    top: planet.size + 4 + 'px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    textShadow: '0 0 4px rgba(0,0,0,0.8)',
                  }}
                >
                  {planet.name}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <div className="relative z-10 flex flex-wrap items-center justify-center gap-4 px-4 pb-4">
        {/* Play/Pause */}
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gray-800/80 border border-gray-600/50 hover:bg-gray-700/80 transition-all text-sm font-medium backdrop-blur-sm"
        >
          {isPlaying ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
              Pause
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <polygon points="5,3 19,12 5,21" />
              </svg>
              Play
            </>
          )}
        </button>

        {/* Speed control */}
        <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-gray-800/80 border border-gray-600/50 backdrop-blur-sm">
          <span className="text-xs text-gray-400 font-medium">Speed:</span>
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="w-24 md:w-32 accent-yellow-400"
          />
          <span className="text-xs text-yellow-400 font-mono w-10">{speed.toFixed(1)}x</span>
        </div>

        {/* Reset button */}
        <button
          onClick={() => {
            setAngles(planets.map(() => Math.random() * Math.PI * 2));
            setSpeed(1);
            setIsPlaying(true);
            setSelectedPlanet(null);
          }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gray-800/80 border border-gray-600/50 hover:bg-gray-700/80 transition-all text-sm font-medium backdrop-blur-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Reset
        </button>
      </div>

      {/* Planet Info Panel */}
      {selectedPlanet && (
        <div className="absolute top-20 right-4 md:right-8 z-20 w-72 md:w-80 animate-fadeIn">
          <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700/60 rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full"
                  style={{
                    background: `radial-gradient(circle at 35% 35%, ${selectedPlanet.color}, ${adjustColor(selectedPlanet.color, -40)})`,
                    boxShadow: `0 0 12px 4px ${selectedPlanet.color}50`,
                  }}
                />
                <h2 className="text-xl font-bold" style={{ color: selectedPlanet.color }}>
                  {selectedPlanet.name}
                </h2>
              </div>
              <button
                onClick={() => setSelectedPlanet(null)}
                className="text-gray-400 hover:text-white transition-colors p-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              {selectedPlanet.description}
            </p>

            <div className="space-y-2.5">
              <InfoRow icon="📏" label="Diameter" value={selectedPlanet.realDiameter} />
              <InfoRow icon="🌞" label="Distance from Sun" value={selectedPlanet.realDistance} />
              <InfoRow icon="🔄" label="Orbital Period" value={selectedPlanet.orbitalPeriod} />
            </div>
          </div>
        </div>
      )}

      {/* Planet quick-select bar */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 px-3 py-2 rounded-full bg-gray-900/70 backdrop-blur-sm border border-gray-700/40">
        {planets.map((planet, i) => (
          <button
            key={i}
            onClick={() => setSelectedPlanet(selectedPlanet?.name === planet.name ? null : planet)}
            className={`w-7 h-7 rounded-full transition-all hover:scale-110 ${
              selectedPlanet?.name === planet.name ? 'ring-2 ring-white scale-110' : ''
            }`}
            style={{
              background: `radial-gradient(circle at 35% 35%, ${planet.color}, ${adjustColor(planet.color, -40)})`,
              boxShadow: `0 0 6px 1px ${planet.color}40`,
            }}
            title={planet.name}
          />
        ))}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 bg-gray-800/60 rounded-lg px-3 py-2">
      <span className="text-base">{icon}</span>
      <div>
        <div className="text-xs text-gray-400">{label}</div>
        <div className="text-sm font-semibold text-white">{value}</div>
      </div>
    </div>
  );
}

function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0x0000ff) + amount));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

export default App;
