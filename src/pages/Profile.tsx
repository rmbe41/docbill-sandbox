import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** Leitet auf die Haupt-App mit eingebettetem Profil-Bereich um (Lesezeichen / alte Links). */
const Profile = () => {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/", { replace: true, state: { openProfile: true } });
  }, [navigate]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Weiterleitung…</p>
    </div>
  );
};

export default Profile;
