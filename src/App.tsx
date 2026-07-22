import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ItemsPage } from './pages/ItemsPage'
import { SettingsPage } from './pages/SettingsPage'
import { AssistantPage } from './pages/AssistantPage'
import { RemindersPage } from './pages/RemindersPage'

function App() {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ItemsPage />} />
            <Route path="/reminders" element={<RemindersPage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </BrowserRouter>
      </ProtectedRoute>
    </AuthProvider>
  )
}

export default App
