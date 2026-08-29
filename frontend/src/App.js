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
import CrmShell from "@/components/crm/CrmShell";
import CrmDashboard from "@/pages/crm/CrmDashboard";
import CrmLeads from "@/pages/crm/Leads";
import CrmLeadDetail from "@/pages/crm/LeadDetail";
import CrmOpportunities from "@/pages/crm/Opportunities";
import CrmMeetings from "@/pages/crm/Meetings";
import CrmAccounts from "@/pages/crm/Accounts";
import CrmMedicare from "@/pages/crm/Medicare";
import CrmUsers from "@/pages/crm/Users";
import CrmPhysician from "@/pages/crm/PhysicianWorkspace";
import CrmProviders from "@/pages/crm/Providers";
import CrmImport from "@/pages/crm/ImportWizard";
import CrmSequences from "@/pages/crm/Sequences";
import EventsHome from "@/pages/EventsHome";

const CRM_ROLES = ["admin", "lead_manager", "account_manager", "staff"];

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Launcher />} />
          <Route path="/home" element={<Launcher />} />
          <Route path="/login" element={<Login />} />
          <Route path="/kiosk" element={<Kiosk />} />
          <Route path="/wheel/:leadId" element={<Wheel />} />
          <Route
            path="/events"
            element={
              <ProtectedRoute roles={CRM_ROLES}>
                <EventsHome />
              </ProtectedRoute>
            }
          />
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
          <Route
            path="/crm"
            element={
              <ProtectedRoute roles={CRM_ROLES}>
                <CrmShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<CrmDashboard />} />
            <Route path="leads" element={<CrmLeads />} />
            <Route path="leads/:id" element={<CrmLeadDetail />} />
            <Route path="physicians/:npi" element={<CrmPhysician />} />
            <Route path="opportunities" element={<CrmOpportunities />} />
            <Route path="meetings" element={<CrmMeetings />} />
            <Route path="accounts" element={<CrmAccounts />} />
            <Route path="medicare" element={<CrmMedicare />} />
            <Route path="sequences" element={<CrmSequences />} />
            <Route path="import" element={<ProtectedRoute roles={["admin", "lead_manager"]}><CrmImport /></ProtectedRoute>} />
            <Route path="providers" element={<ProtectedRoute adminOnly><CrmProviders /></ProtectedRoute>} />
            <Route path="users" element={<ProtectedRoute adminOnly><CrmUsers /></ProtectedRoute>} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" richColors />
    </AuthProvider>
  );
}

export default App;
