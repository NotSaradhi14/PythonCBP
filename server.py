#---------------------------------------------------------------------------------------
# Name:        module1
# Purpose:
#
# Author:      saradhi
#
# Created:     20-02-2026
# Copyright:   (c) saradhi 2026
# Licence:     <your licence>
#---------------------------------------------------------------------------------------


import math
import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

try:
    import requests as http_requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

try:
    import google.generativeai as genai
    import os
    # Use environment variable if set, otherwise fall back to hardcoded key
    api_key = os.getenv("GEMINI_API_KEY", "AIzaSyAOMnQIthk4npViz1C8ESds3O2eD9S00cc")
    if api_key:
        genai.configure(api_key=api_key)
        HAS_GEMINI = True
    else:
        HAS_GEMINI = False
except ImportError:
    HAS_GEMINI = False

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)

WEATHER_API_KEY = "00be08a17bc6fa76e549682e5ed4fc99"
WEATHER_URL = "https://api.openweathermap.org/data/2.5/weather"
FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast"


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


# ══════════ TEXTURE PROXY (bypass CORS for external images) ══════════
@app.route("/api/proxy-texture")
def proxy_texture():
    if not HAS_REQUESTS:
        return "requests not installed", 500
    url = request.args.get("url", "").strip()
    if not url or not url.startswith("https://"):
        return "Invalid URL", 400
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        r = http_requests.get(url, timeout=30, headers=headers, stream=True)
        r.raise_for_status()
        content_type = r.headers.get("Content-Type", "image/png")
        from flask import Response
        def generate():
            for chunk in r.iter_content(chunk_size=8192):
                yield chunk
        return Response(generate(), mimetype=content_type,
                        headers={"Cache-Control": "public, max-age=86400"})
    except Exception as e:
        return str(e), 500


# ══════════ REVERSE GEOCODING API ══════════
@app.route("/api/geocode")
def geocode():
    lat = request.args.get("lat", "").strip()
    lon = request.args.get("lon", "").strip()
    if not lat or not lon:
        return jsonify({"error": "lat and lon required"}), 400
    if not HAS_REQUESTS:
        return jsonify({"error": "requests not installed"}), 500
    try:
        headers = {"User-Agent": "SciWeather/1.0 (educational project)"}
        r = http_requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"format": "json", "lat": lat, "lon": lon, "zoom": 5},
            headers=headers, timeout=10
        )
        r.raise_for_status()
        data = r.json()
        addr = data.get("address", {})
        return jsonify({
            "country": addr.get("country", "Unknown"),
            "country_code": addr.get("country_code", "").upper(),
            "state": addr.get("state", addr.get("region", "")),
            "city": addr.get("city", addr.get("town", addr.get("village", ""))),
            "display_name": data.get("display_name", ""),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ══════════ WEATHER BY EXACT COORDINATES ══════════
@app.route("/api/weather-by-coords")
def weather_by_coords():
    lat = request.args.get("lat", "").strip()
    lon = request.args.get("lon", "").strip()
    if not lat or not lon:
        return jsonify({"error": "lat and lon required"}), 400
    if not HAS_REQUESTS:
        return jsonify({"error": "requests not installed"}), 500
    try:
        params = {"lat": lat, "lon": lon, "appid": WEATHER_API_KEY, "units": "metric"}
        r = http_requests.get(WEATHER_URL, params=params, timeout=10)
        r.raise_for_status()
        d = r.json()
        t = d["main"]["temp"]
        rh = d["main"]["humidity"]
        ws = d["wind"]["speed"]
        ws_kph = round(ws * 3.6, 1)
        tf = t * 9/5 + 32
        hi_f = -42.379+2.04901523*tf+10.14333127*rh-0.22475541*tf*rh-0.00683783*tf**2-0.05481717*rh**2+0.00122874*tf**2*rh+0.00085282*tf*rh**2-0.00000199*tf**2*rh**2
        heat_index = round((hi_f-32)*5/9, 1) if tf > 80 else round(t, 1)
        wind_chill = round(13.12+0.6215*t-11.37*(ws_kph**0.16)+0.3965*t*(ws_kph**0.16), 1) if t < 10 and ws_kph > 4.8 else round(t, 1)
        dew_point = round(t - (100 - rh)/5, 1)
        clat = d["coord"]["lat"]
        clon = d["coord"]["lon"]
        month = datetime.datetime.now().month
        uv = max(0, round(12*math.cos(math.radians(clat))*(1+0.3*math.cos(math.radians(30*(month-6)))), 1))
        uv_cat = "Low" if uv<3 else "Moderate" if uv<6 else "High" if uv<8 else "Very High" if uv<11 else "Extreme"

        # Fetch AQI
        aqi_val = 1
        pm2_5 = 0
        try:
            aqi_r = http_requests.get("http://api.openweathermap.org/data/2.5/air_pollution", params={"lat": clat, "lon": clon, "appid": WEATHER_API_KEY}, timeout=5)
            if aqi_r.status_code == 200:
                aqi_d = aqi_r.json()
                aqi_val = aqi_d["list"][0]["main"]["aqi"]
                pm2_5 = aqi_d["list"][0]["components"].get("pm2_5", 0)
        except:
            pass

        return jsonify({
            "city": d["name"], "country": d["sys"].get("country", ""),
            "lat": clat, "lon": clon,
            "timezone": d.get("timezone", 0),
            "temp": round(t, 1), "feels_like": round(d["main"]["feels_like"], 1),
            "humidity": rh, "pressure": d["main"]["pressure"],
            "wind_kph": ws_kph, "description": d["weather"][0]["description"].title(),
            "icon": d["weather"][0]["icon"],
            "heat_index": heat_index, "wind_chill": wind_chill,
            "dew_point": dew_point, "uv_index": uv, "uv_category": uv_cat,
            "aqi": aqi_val, "pm2_5": round(pm2_5, 1)
        })
    except http_requests.exceptions.HTTPError as e:
        code = e.response.status_code
        if code == 404: return jsonify({"error": "No weather data for this location"}), 404
        return jsonify({"error": str(e)}), code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ══════════ CALCULATOR API ══════════
@app.route("/api/calculate", methods=["POST"])
def calculate():
    data = request.get_json()
    expr = data.get("expression", "").strip()
    if not expr:
        return jsonify({"error": "Empty expression"}), 400
    try:
        safe_ns = {
            "sin": lambda x: math.sin(math.radians(x)),
            "cos": lambda x: math.cos(math.radians(x)),
            "tan": lambda x: math.tan(math.radians(x)),
            "sinr": math.sin, "cosr": math.cos, "tanr": math.tan,
            "asin": lambda x: math.degrees(math.asin(x)),
            "acos": lambda x: math.degrees(math.acos(x)),
            "atan": lambda x: math.degrees(math.atan(x)),
            "log": math.log10, "ln": math.log,
            "sqrt": math.sqrt, "abs": abs,
            "factorial": math.factorial,
            "pi": math.pi, "e": math.e,
            "pow": pow, "ceil": math.ceil, "floor": math.floor,
        }
        result = eval(expr, {"__builtins__": {}}, safe_ns)
        if isinstance(result, float):
            if result == int(result) and abs(result) < 1e15:
                result = int(result)
            else:
                result = round(result, 10)
        return jsonify({"expression": expr, "result": str(result), "success": True})
    except ZeroDivisionError:
        return jsonify({"error": "Division by zero"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ══════════ CONVERSION API ══════════
@app.route("/api/convert", methods=["POST"])
def convert_temp():
    data = request.get_json()
    value = data.get("value", 0)
    from_unit = data.get("from", "C")
    try:
        value = float(value)
        if from_unit == "C":
            f = value * 9/5 + 32
            k = value + 273.15
            return jsonify({"C": round(value, 2), "F": round(f, 2), "K": round(k, 2)})
        elif from_unit == "F":
            c = (value - 32) * 5/9
            k = c + 273.15
            return jsonify({"C": round(c, 2), "F": round(value, 2), "K": round(k, 2)})
        else:
            c = value - 273.15
            f = c * 9/5 + 32
            return jsonify({"C": round(c, 2), "F": round(f, 2), "K": round(value, 2)})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ══════════ FORMULA API ══════════
@app.route("/api/formula", methods=["POST"])
def formula():
    data = request.get_json()
    ftype = data.get("type", "")
    try:
        if ftype == "bmi":
            w, h = float(data["weight"]), float(data["height"])
            bmi = w / (h ** 2)
            cat = "Underweight" if bmi < 18.5 else "Normal" if bmi < 25 else "Overweight" if bmi < 30 else "Obese"
            return jsonify({"result": round(bmi, 1), "category": cat})
        elif ftype == "wind_chill":
            t, v = float(data["temp"]), float(data["wind"])
            wc = 13.12 + 0.6215*t - 11.37*(v**0.16) + 0.3965*t*(v**0.16)
            return jsonify({"result": round(wc, 1)})
        elif ftype == "heat_index":
            t, rh = float(data["temp"]), float(data["humidity"])
            tf = t * 9/5 + 32
            hi = -42.379 + 2.04901523*tf + 10.14333127*rh - 0.22475541*tf*rh - 0.00683783*tf**2 - 0.05481717*rh**2 + 0.00122874*tf**2*rh + 0.00085282*tf*rh**2 - 0.00000199*tf**2*rh**2
            hi_c = (hi - 32) * 5/9
            return jsonify({"result": round(hi_c, 1)})
        elif ftype == "uv_index":
            lat = float(data.get("lat", 17))
            month = int(data.get("month", datetime.datetime.now().month))
            uv = max(0, 12 * math.cos(math.radians(lat)) * (1 + 0.3*math.cos(math.radians(30*(month-6)))))
            cat = "Low" if uv<3 else "Moderate" if uv<6 else "High" if uv<8 else "Very High" if uv<11 else "Extreme"
            return jsonify({"result": round(uv, 1), "category": cat})
        return jsonify({"result": 0.0, "error": "Unknown formula type"}), 400
    except Exception as e:
        return jsonify({"result": 0.0, "error": str(e)}), 500


# ══════════ AI FEATURES (Gemini) ══════════
@app.route("/api/ai-summary", methods=["POST"])
def ai_summary():
    if not HAS_GEMINI:
        return jsonify({"error": "Gemini API key missing or google-generativeai not installed. Please set GEMINI_API_KEY."}), 501

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    city = data.get("city", "Unknown")
    temp = data.get("temp", "--")
    desc = data.get("description", "--")
    humidity = data.get("humidity", "--")
    wind = data.get("wind", "--")

    prompt = f"Write a very short, friendly, and highly relatable 1-2 sentence weather summary for {city}. The current weather is {temp}°C, {desc}, humidity {humidity}%, wind {wind} km/h. Give a quick practical tip (e.g. 'wear a jacket', 'stay hydrated', 'good day for a walk'). No greetings or markdown, just the short summary."

    try:
        model = genai.GenerativeModel('gemini-2.5-flash')
        response = model.generate_content(prompt)
        return jsonify({"summary": response.text.strip()})
    except Exception as e:
        print(f"[AI-Summary Error] {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai-chat", methods=["POST"])
def ai_chat():
    if not HAS_GEMINI:
        return jsonify({"error": "Gemini API key missing or google-generativeai not installed."}), 501

    data = request.get_json()
    message = data.get("message", "").strip()
    weather_context = data.get("context", {})

    if not message:
        return jsonify({"error": "No message provided"}), 400

    system_prompt = f"""You are Sci-Guide, a friendly, concise, and smart AI weather assistant built into the SciWeather dashboard.
You help users make decisions based on the current weather.
Current weather context for {weather_context.get('city', 'Unknown')}:
- Temperature: {weather_context.get('temp')}°C (Feels like {weather_context.get('feels_like')}°C)
- Condition: {weather_context.get('desc')}
- Humidity: {weather_context.get('humidity')}%
- Wind: {weather_context.get('wind')} km/h
- Heat Index: {weather_context.get('heat_index')}°C
- UV Index: {weather_context.get('uv')}

Answer the user's question directly, keeping your response under 3 sentences. Be practical and relatable."""

    try:
        model = genai.GenerativeModel('gemini-2.5-flash')
        response = model.generate_content(f"{system_prompt}\n\nUser: {message}")
        return jsonify({"reply": response.text.strip()})
    except Exception as e:
        print(f"[AI-Chat Error] {e}")
        return jsonify({"error": str(e)}), 500


# ══════════ WEATHER API ══════════
@app.route("/api/weather", methods=["GET"])
def weather():
    city = request.args.get("city", "").strip()
    if not city:
        return jsonify({"error": "City required"}), 400
    if WEATHER_API_KEY == "YOUR_OPENWEATHERMAP_API_KEY":
        return jsonify(_demo_weather(city))
    if not HAS_REQUESTS:
        return jsonify({"error": "requests not installed"}), 500
    try:
        params = {"q": city, "appid": WEATHER_API_KEY, "units": "metric"}
        r = http_requests.get(WEATHER_URL, params=params, timeout=10)
        r.raise_for_status()
        d = r.json()
        t = d["main"]["temp"]
        rh = d["main"]["humidity"]
        ws = d["wind"]["speed"]
        # Weather intelligence calculations
        tf = t*9/5+32
        hi_f = -42.379+2.04901523*tf+10.14333127*rh-0.22475541*tf*rh-0.00683783*tf**2-0.05481717*rh**2+0.00122874*tf**2*rh+0.00085282*tf*rh**2-0.00000199*tf**2*rh**2
        heat_index = round((hi_f-32)*5/9, 1) if tf > 80 else round(t, 1)
        ws_kph = ws * 3.6
        wind_chill = round(13.12+0.6215*t-11.37*(ws_kph**0.16)+0.3965*t*(ws_kph**0.16), 1) if t < 10 and ws_kph > 4.8 else round(t, 1)
        dew_point = round(t - (100 - rh)/5, 1)
        lat = d["coord"]["lat"]
        lon = d["coord"]["lon"]
        month = datetime.datetime.now().month
        uv = max(0, round(12*math.cos(math.radians(lat))*(1+0.3*math.cos(math.radians(30*(month-6)))), 1))
        uv_cat = "Low" if uv<3 else "Moderate" if uv<6 else "High" if uv<8 else "Very High" if uv<11 else "Extreme"
        sunrise = datetime.datetime.fromtimestamp(d["sys"]["sunrise"]).strftime("%H:%M")
        sunset = datetime.datetime.fromtimestamp(d["sys"]["sunset"]).strftime("%H:%M")

        # Fetch AQI
        aqi_val = 1
        pm2_5 = 0
        try:
            aqi_r = http_requests.get("http://api.openweathermap.org/data/2.5/air_pollution", params={"lat": lat, "lon": lon, "appid": WEATHER_API_KEY}, timeout=5)
            if aqi_r.status_code == 200:
                aqi_d = aqi_r.json()
                aqi_val = aqi_d["list"][0]["main"]["aqi"]
                pm2_5 = aqi_d["list"][0]["components"].get("pm2_5", 0)
        except:
            pass

        return jsonify({
            "demo": False, "city": d["name"],
            "country": d["sys"].get("country", ""),
            "timezone": d.get("timezone", 0),
            "temp": round(t, 1), "feels_like": round(d["main"]["feels_like"], 1),
            "temp_min": round(d["main"]["temp_min"], 1), "temp_max": round(d["main"]["temp_max"], 1),
            "humidity": rh, "pressure": d["main"]["pressure"],
            "wind_speed": ws, "wind_kph": round(ws_kph, 1),
            "visibility": round(d.get("visibility", 0)/1000, 1),
            "description": d["weather"][0]["description"].title(),
            "main": d["weather"][0]["main"], "icon": d["weather"][0]["icon"],
            "sunrise": sunrise, "sunset": sunset,
            "heat_index": heat_index, "wind_chill": wind_chill,
            "dew_point": dew_point, "uv_index": uv, "uv_category": uv_cat,
            "aqi": aqi_val, "pm2_5": round(pm2_5, 1),
            "lat": lat, "lon": lon,
        })
    except http_requests.exceptions.HTTPError as e:
        code = e.response.status_code
        if code == 404: return jsonify({"error": f"City '{city}' not found"}), 404
        if code == 401: return jsonify({"error": "Invalid API key"}), 401
        return jsonify({"error": str(e)}), code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/forecast", methods=["GET"])
def forecast():
    city = request.args.get("city", "").strip()
    if not city:
        return jsonify({"error": "City required"}), 400
    if WEATHER_API_KEY == "YOUR_OPENWEATHERMAP_API_KEY":
        return jsonify(_demo_forecast())
    if not HAS_REQUESTS:
        return jsonify({"error": "requests not installed"}), 500
    try:
        params = {"q": city, "appid": WEATHER_API_KEY, "units": "metric"}
        r = http_requests.get(FORECAST_URL, params=params, timeout=10)
        r.raise_for_status()
        data = r.json()
        # 24h hourly data
        hourly = []
        for item in data.get("list", [])[:8]:
            dt = datetime.datetime.fromtimestamp(item["dt"])
            hourly.append({"time": dt.strftime("%I %p"), "temp": round(item["main"]["temp"])})
        # Daily summary
        daily = {}
        for item in data.get("list", []):
            dt = datetime.datetime.fromtimestamp(item["dt"])
            dk = dt.strftime("%a")
            if dk not in daily and len(daily) < 5:
                daily[dk] = {"day": dk, "temp": round(item["main"]["temp"]),
                             "main": item["weather"][0]["main"],
                             "description": item["weather"][0]["description"].title(),
                             "icon": item["weather"][0]["icon"]}
        return jsonify({"forecast": list(daily.values()), "hourly": hourly})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _demo_weather(city):
    return {
        "demo": True, "city": city.title(), "country": "DEMO",
        "temp": 32, "feels_like": 37, "temp_min": 28, "temp_max": 35,
        "humidity": 70, "pressure": 1008, "wind_speed": 5, "wind_kph": 18,
        "visibility": 8.0, "description": "Partly Cloudy", "main": "Clouds",
        "icon": "02d", "sunrise": "06:15", "sunset": "18:42",
        "heat_index": 37.6, "wind_chill": 29.8, "dew_point": 26.4,
        "uv_index": 8.2, "uv_category": "Very High", "lat": 17.4, "lon": 78.5,
    }

def _demo_forecast():
    return {
        "forecast": [
            {"day":"Mon","temp":29,"main":"Clear","description":"Sunny","icon":"01d"},
            {"day":"Tue","temp":27,"main":"Clouds","description":"Partly Cloudy","icon":"02d"},
            {"day":"Wed","temp":31,"main":"Rain","description":"Light Rain","icon":"10d"},
            {"day":"Thu","temp":26,"main":"Clouds","description":"Cloudy","icon":"04d"},
            {"day":"Fri","temp":28,"main":"Clear","description":"Sunny","icon":"01d"},
        ],
        "hourly": [
            {"time":"12 AM","temp":28},{"time":"03 AM","temp":27},
            {"time":"06 AM","temp":26},{"time":"09 AM","temp":29},
            {"time":"12 PM","temp":32},{"time":"03 PM","temp":34},
            {"time":"06 PM","temp":31},{"time":"09 PM","temp":29},
        ],
    }


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  [*] SciWeather Server")
    print(f"  [>] http://localhost:{port}\n")
    app.run(host="0.0.0.0", debug=True, port=port)
