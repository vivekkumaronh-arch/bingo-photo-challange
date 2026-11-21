import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CONFETTI_COLORS } from '../utils/celebration';

interface CelebrationBurstProps {
  triggerKey: number;
  message?: string;
}

const PARTICLES = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2;
  const distance = 65 + (i % 3) * 35;
  return {
    id: i,
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance - 20,
    rotate: (i * 47) % 360,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: i % 2 === 0 ? 10 : 8,
  };
});

export function CelebrationBurst({ triggerKey, message }: CelebrationBurstProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (triggerKey <= 0) return;
    setVisible(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [triggerKey]);

  if (triggerKey <= 0 || !visible) return null;

  return (
    <div
      key={triggerKey}
      aria-live="polite"
      className="fixed inset-0 pointer-events-none z-50 flex flex-col items-center justify-center"
    >
      <div className="relative flex items-center justify-center">
        {PARTICLES.map((p) => (
          <motion.span
            key={p.id}
            initial={{ opacity: 1, x: 0, y: 0, scale: 0.6, rotate: 0 }}
            animate={{
              opacity: 0,
              x: p.x,
              y: p.y,
              scale: 1.15,
              rotate: p.rotate,
            }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            style={{
              backgroundColor: p.color,
              width: p.size,
              height: p.size,
            }}
            className="absolute rounded-sm"
          />
        ))}
      </div>

      {message && (
        <motion.div
          initial={{ opacity: 0, y: -16, scale: 0.95 }}
          animate={{ opacity: [0, 1, 1, 0], y: [-16, 0, 0, -8], scale: [0.95, 1, 1, 0.98] }}
          transition={{ duration: 1.75, times: [0, 0.12, 0.8, 1] }}
          className="fixed top-16 px-5 py-2.5 rounded-2xl bg-[#172E4D] text-white font-display font-bold text-sm sm:text-base shadow-lg"
        >
          {message}
        </motion.div>
      )}
    </div>
  );
}
