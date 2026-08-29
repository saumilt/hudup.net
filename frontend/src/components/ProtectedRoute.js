import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

export function ProtectedRoute({ children, adminOnly = false, roles = null }) {
  const { user } = useAuth();
  if (user === null)
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  if (user === false) return <Navigate to="/login" replace />;
  if (adminOnly && !["admin", "super_admin"].includes(user.role)) return <Navigate to="/crm" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}
