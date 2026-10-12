import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WalletProvider } from "@/hooks/useWallet";
import { ThemeProvider } from "next-themes";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useNewMessageNotification } from "@/hooks/useNewMessageNotification";
import { useTradeDeadlineReminders } from "@/hooks/useTradeDeadlineReminders";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import AdminDisputeDetail from "./pages/AdminDisputeDetail";
import Alerts from "./pages/Alerts";

const queryClient = new QueryClient();

// Component to initialize WebSocket connection and new-message notifications
function OnlineStatusProvider({ children }: { children: React.ReactNode }) {
  useOnlineStatus(); // Initialize WebSocket connection
  useNewMessageNotification(); // Toast + invalidate when user receives a message
  useTradeDeadlineReminders(); // Toast (and background notification) before a trade deadline the user must meet
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="kadena-nexus-theme">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <WalletProvider>
            <OnlineStatusProvider>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/u/:wallet" element={<Profile />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/admin/disputes/:offerId" element={<AdminDisputeDetail />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </OnlineStatusProvider>
          </WalletProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
