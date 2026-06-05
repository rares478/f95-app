import { useOutletContext } from 'react-router-dom';
import type { ProfileDto } from '../types';
import { ProfileView } from '../components/ProfileView';

interface OutletCtx {
  profile: ProfileDto;
  onLoggedOut: () => void;
}

export function ProfilePage() {
  const { profile, onLoggedOut } = useOutletContext<OutletCtx>();
  return <ProfileView profile={profile} onLoggedOut={onLoggedOut} />;
}
