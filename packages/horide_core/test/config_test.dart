import 'package:flutter_test/flutter_test.dart';
import 'package:horide_core/horide_core.dart';

void main() {
  test('release builds need an https API address; debug builds accept the emulator default', () {
    expect(HorideConfig.checkApiUrl('http://10.0.2.2:3000', release: false), isNull);
    expect(HorideConfig.checkApiUrl('http://10.0.2.2:3000', release: true), isNotNull);
    expect(HorideConfig.checkApiUrl('https://', release: true), isNotNull);
    expect(HorideConfig.checkApiUrl('https://api.horide.example', release: true), isNull);
  });
}
