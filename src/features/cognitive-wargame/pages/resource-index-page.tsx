import { Navigate, useLocation } from 'react-router';

import { WargameRoutes } from '../routes';

export default function ResourceIndexPage() {
  const location = useLocation();

  return (
    <Navigate
      to={`${WargameRoutes.ResourceSkills}${location.search}`}
      replace
    />
  );
}
