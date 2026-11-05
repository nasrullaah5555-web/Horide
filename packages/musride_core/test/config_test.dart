import 'package:flutter_test/flutter_test.dart';
import 'package:musride_core/musride_core.dart';

void main() {
  test('release builds need an https API address; debug builds accept the emulator default', () {
    expect(MusrideConfig.checkApiUrl('http://10.0.2.2:3000', release: false), isNull);
    expect(MusrideConfig.checkApiUrl('http://10.0.2.2:3000', release: true), isNotNull);
    expect(MusrideConfig.checkApiUrl('https://', release: true), isNotNull);
    expect(MusrideConfig.checkApiUrl('https://api.musride.example', release: true), isNull);
  });
}
