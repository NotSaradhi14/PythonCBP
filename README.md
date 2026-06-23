---
title: SciWeather
emoji: 🌍
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# 🌍 SciWeather - Globe & Weather Intelligence Dashboard


SciWeather is a state-of-the-art, interactive 3D Globe and Weather Intelligence Dashboard. It combines modern frontend visualizations with advanced meteorological calculations and real-time AI assistance powered by Google Gemini.

---

## ✨ Features

- **🌍 Interactive 3D Globe**: Built using `Three.js`. Drag, rotate, and click anywhere on the globe to perform reverse geocoding (OpenStreetMap) and retrieve instant weather reports for that precise coordinate.
- **☀️ Weather Intelligence (Calculated)**: Real-time calculation of advanced meteorological metrics including:
  - **Heat Index** (Perceived Temperature)
  - **Wind Chill** (Wind cooling effect)
  - **Dew Point** (Comfort level)
  - **UV Index** (Sun exposure safety category)
  - **Air Quality Index (AQI)** & PM2.5 levels
- **🤖 Sci-Guide AI Assistant**: An integrated chat interface powered by **Google Gemini 2.5 Flash** that acts as your weather advisor, providing daily summaries and personalized clothing or travel tips.
- **🧮 Smart Calculator Tools**:
  - **Travel Time Calculator**: Plan routes based on speed and local weather conditions.
  - **Fuel Efficiency Estimator**: Calculate fuel consumption and costs.
  - **Clothing Advisor**: Get smart recommendations on what to wear based on current temperature and humidity.
  - **Rain Probability Calculator**: Estimate precipitation chances.
- **📚 Interactive Formula Library**: Learn the mathematical formulas behind BMI, Wind Chill, Heat Index, and UV Index with built-in calculators.
- **📊 24-Hour Temperature Chart**: Visualizes the upcoming hourly temperature trend using `Chart.js`.
- **🌓 Adaptive UI**: Sleek, modern dashboard design with full support for Light and Dark modes.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla CSS, JavaScript, [Three.js](https://threejs.org/) (3D Globe), [Chart.js](https://www.chartjs.org/) (Trends).
- **Backend**: Python, [Flask](https://flask.palletsprojects.com/) (Web framework), [Flask-CORS](https://flask-cors.readthedocs.io/).
- **APIs**:
  - [OpenWeatherMap API](https://openweathermap.org/api) (Weather & Air Pollution data).
  - [Nominatim OpenStreetMap API](https://nominatim.org/) (Reverse Geocoding).
  - [Google Gemini API](https://ai.google.dev/) (AI Chat & weather insights).

---

## 🚀 Installation & Local Setup

### 1. Clone the Repository
```bash
git clone https://github.com/NotSaradhi14/PythonCBP.git
cd PythonCBP
```

### 2. Install Dependencies
Make sure Python 3.8+ is installed, then run:
```bash
pip install -r requirements.txt
```

### 3. Configure API Keys
Set your Gemini API Key in your environment variables:
* **Windows (CMD)**:
  ```cmd
  set GEMINI_API_KEY=your_gemini_api_key
  ```
* **Linux/macOS**:
  ```bash
  export GEMINI_API_KEY="your_gemini_api_key"
  ```
*(Note: If no key is set, the server will fallback to the default demo mode key).*

### 4. Run the Application
```bash
python server.py
```
Open your browser and navigate to **`http://localhost:5000`** to view the app!
