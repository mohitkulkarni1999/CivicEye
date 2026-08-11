import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import ChatWidget from './components/ChatWidget.jsx';
import { useAuth } from './lib/auth.jsx';
import { PageLoader } from './components/Spinner.jsx';
import Landing from './pages/Landing.jsx';
import MapPage from './pages/MapPage.jsx';
import Explore from './pages/Explore.jsx';
import Report from './pages/Report.jsx';
import IssueDetail from './pages/IssueDetail.jsx';
import Auth from './pages/Auth.jsx';
import OfficerAuth from './pages/OfficerAuth.jsx';
import AdminAuth from './pages/AdminAuth.jsx';
import MyReports from './pages/MyReports.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import CityDashboard from './pages/CityDashboard.jsx';
import CitizenDashboard from './pages/CitizenDashboard.jsx';
import OfficerDashboard from './pages/OfficerDashboard.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import AccessDenied from './pages/AccessDenied.jsx';

function RequireAuth({ children }) {
  const { isAuthed, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAuthed) return <Navigate to="/citizen/login" replace />;
  return children;
}

function RequireCitizen({ children }) {
  const { isCitizen, isAuthed, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAuthed) return <Navigate to="/citizen/login" replace />;
  if (!isCitizen) return <AccessDenied />;
  return children;
}

function RequireOfficer({ children }) {
  const { isOfficer, isAuthed, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAuthed) return <Navigate to="/officer/login" replace />;
  if (!isOfficer) return <AccessDenied />;
  return children;
}

function RequireAdmin({ children }) {
  const { isAdmin, isAuthed, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAuthed) return <Navigate to="/admin/login" replace />;
  if (!isAdmin) return <AccessDenied />;
  return children;
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/issues/:id" element={<IssueDetail />} />
          <Route path="/dashboard" element={<CityDashboard />} />
          <Route path="/report" element={<Report />} />

          {/* Citizen portal */}
          <Route path="/citizen/login" element={<Auth defaultMode="login" />} />
          <Route path="/citizen/register" element={<Auth defaultMode="register" />} />
          <Route
            path="/citizen/dashboard"
            element={
              <RequireCitizen>
                <CitizenDashboard />
              </RequireCitizen>
            }
          />

          {/* Officer portal */}
          <Route path="/officer/login" element={<OfficerAuth />} />
          <Route path="/officer/register" element={<Navigate to="/officer/login" replace />} />
          <Route
            path="/officer/dashboard"
            element={
              <RequireOfficer>
                <OfficerDashboard />
              </RequireOfficer>
            }
          />
          <Route path="/officer" element={<Navigate to="/officer/dashboard" replace />} />

          {/* Admin portal */}
          <Route path="/admin/login" element={<AdminAuth />} />
          <Route path="/admin/register" element={<Navigate to="/admin/login" replace />} />
          <Route
            path="/admin/dashboard"
            element={
              <RequireAdmin>
                <AdminDashboard />
              </RequireAdmin>
            }
          />
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />

          <Route path="/auth" element={<Navigate to="/citizen/login" replace />} />
          <Route
            path="/my-reports"
            element={
              <RequireAuth>
                <MyReports />
              </RequireAuth>
            }
          />
          <Route
            path="/notifications"
            element={
              <RequireAuth>
                <NotificationsPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
      <ChatWidget />
    </div>
  );
}
