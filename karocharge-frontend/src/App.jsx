import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import HostMode from "./pages/HostMode";
import ChargeMode from "./pages/ChargeMode";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host" element={<HostMode />} />
        <Route path="/charge" element={<ChargeMode />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
