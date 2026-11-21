import {
  Briefcase,
  Cake,
  Heart,
  Languages,
  Lightbulb,
  MapPin,
  Palette,
  Plane,
  Type,
} from 'lucide-react';
import type { ChallengeDefinition } from '../shared/challenges';

interface ChallengeIconProps {
  name: ChallengeDefinition['iconName'];
  className?: string;
}

export function ChallengeIcon({ name, className = 'w-5 h-5' }: ChallengeIconProps) {
  switch (name) {
    case 'cake':
      return <Cake className={className} aria-hidden="true" />;
    case 'palette':
      return <Palette className={className} aria-hidden="true" />;
    case 'briefcase':
      return <Briefcase className={className} aria-hidden="true" />;
    case 'type':
      return <Type className={className} aria-hidden="true" />;
    case 'lightbulb':
      return <Lightbulb className={className} aria-hidden="true" />;
    case 'plane':
      return <Plane className={className} aria-hidden="true" />;
    case 'heart':
      return <Heart className={className} aria-hidden="true" />;
    case 'languages':
      return <Languages className={className} aria-hidden="true" />;
    case 'mapPin':
      return <MapPin className={className} aria-hidden="true" />;
  }
}
