/// Ethiopian public emergency numbers shown by the emergency button.
/// Must match the backend list (EMERGENCY_NUMBERS). Local confirmation: owner action OA-19.
class EmergencyNumber {
  const EmergencyNumber(this.service, this.number);
  final String service;
  final String number;
}

const emergencyNumbers = <EmergencyNumber>[
  EmergencyNumber('Police', '991'),
  EmergencyNumber('Ambulance', '907'),
  EmergencyNumber('Fire', '939'),
  EmergencyNumber('Traffic police', '945'),
];
