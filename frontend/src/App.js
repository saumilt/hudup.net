import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Toaster } from "@/components/ui/sonner";
import Launcher from "@/pages/Launcher";
import Login from "@/pages/Login";
import Kiosk from "@/pages/Kiosk";
import Wheel from "@/pages/Wheel";
import Dashboard from "@/pages/Dashboard";
import Admin from "@/pages/Admin";
import LeadsScreen from "@/pages/LeadsScreen";
import LeadDetail from "@/pages/LeadDetail";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Launcher />} />
          <Route path="/login" element={<Login />} />
          <Route path="/kiosk" element={<Kiosk />} />
          <Route path="/wheel/:leadId" element={<Wheel />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/leads"
            element={
              <ProtectedRoute>
                <LeadsScreen />
              </ProtectedRoute>
            }
          />
          <Route
            path="/lead/:leadId"
            element={
              <ProtectedRoute>
                <LeadDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly>
                <Admin />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" richColors />
    </AuthProvider>
  );
}

export default App;
