import { useNavigate } from "react-router-dom";
import "./Home.css";

function Home() {
  const navigate = useNavigate();

  return (
    <div className="home-container">
      <div
        className="mode-card"
        onClick={() => navigate("/host")}
      >
        HOST MODE
      </div>

      <div
        className="mode-card"
        onClick={() => navigate("/charge")}
      >
        CHARGE MODE
      </div>
    </div>
  );
}

export default Home;
