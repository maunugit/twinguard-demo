# TwinGuard demo (static)

A research prototype from the University of Eastern Finland (UEF), made in the EU MATISSE project.
It shows one predictive-maintenance flow on a forest harvester: machine signals over time, an anomaly
detector learned from normal operation, a suspected component on a 3D model, and an inspection procedure.

**Everything runs on synthetic data.** The prototype has not been trained on, validated against or
connected to any real machine or manufacturer system.

This is a static export: the detector ran once and its results are stored in `api/`, so the page needs
no server. Open the live page, choose a scenario and press Play (Space). `?scenario=pump_wear&t=400`
opens a given moment.

## Credits

- 3D model: “Forest Harvester” by Lassi Kaukonen, CC BY 4.0
  (https://sketchfab.com/3d-models/forest-harvester-0aab74ad25fd499dbf077044e4f2154d). Generic model, not manufacturer CAD.
- Inspection course linked from the procedure: “Ponsse Scorpion Harvester Onboarding” by WinNova,
  funded by Metsämiesten Säätiö (https://www.thinglink.com/coursecard/1908864739518186340).
- three.js r169, MIT licence (`vendor/three/LICENSE`).
