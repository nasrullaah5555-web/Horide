import 'package:flutter_test/flutter_test.dart';
import 'package:musride_core/musride_core.dart';

void main() {
  group('formatEtb', () {
    test('formats santim strings exactly', () {
      expect(formatEtb('11500'), '115.00 ETB');
      expect(formatEtb('3876'), '38.76 ETB');
      expect(formatEtb('5'), '0.05 ETB');
      expect(formatEtb('123456789'), '1,234,567.89 ETB');
      expect(formatEtb(null), '—');
      expect(formatEtb('not a number'), '—');
    });

    test('short form drops .00', () {
      expect(formatEtbShort('11500'), '115 ETB');
      expect(formatEtbShort('3876'), '38.76 ETB');
    });
  });

  group('normalizeEthiopianMobile (same cases as the backend)', () {
    const valid = {
      '0911234567': '+251911234567',
      '911234567': '+251911234567',
      '251911234567': '+251911234567',
      '+251911234567': '+251911234567',
      '+251 91 123 4567': '+251911234567',
      '0711234567': '+251711234567',
    };
    valid.forEach((input, expected) {
      test('$input → $expected', () => expect(normalizeEthiopianMobile(input), expected));
    });

    for (final input in ['', '0811234567', '+254711234567', '09112345', '091123456789', 'abc']) {
      test('rejects "$input"', () => expect(normalizeEthiopianMobile(input), isNull));
    }
  });

  test('emergency numbers match the backend list', () {
    expect(emergencyNumbers.map((e) => '${e.service}=${e.number}'), [
      'Police=991',
      'Ambulance=907',
      'Fire=939',
      'Traffic police=945',
    ]);
  });

  test('distance and time formatting', () {
    expect(formatKm(4930), '4.9 km');
    expect(formatMinutes(30), '1 min');
    expect(formatMinutes(610), '11 min');
  });
}
