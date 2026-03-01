#!/usr/bin/env python3
"""
Haupteinstiegspunkt - Startet alle Services
"""
import os
import sys

if __name__ == '__main__':
    # Füge das App-Verzeichnis zum Python-Pfad hinzu
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    
    from app.app import app, init_database
    
    # Initialisiere die Datenbank
    init_database()
    
    print("=" * 50)
    print("Starte den Server...")
    print("=" * 50)
    
    # Starte die Flask-App
    app.run(debug=False, host='0.0.0.0', port=5000, threaded=True)