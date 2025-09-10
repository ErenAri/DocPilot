import unittest
from .embeddings import redact_pii


class TestRedaction(unittest.TestCase):
    def test_email(self):
        s = "Contact me at john.doe@example.com for details."
        r = redact_pii(s)
        self.assertNotIn("john.doe@example.com", r)
        self.assertIn("[REDACTED_EMAIL]", r)

    def test_phone(self):
        s = "Call +1 (415) 555-2671 tomorrow."
        r = redact_pii(s)
        self.assertNotIn("415", r)
        self.assertIn("[REDACTED_PHONE]", r)

    def test_ssn(self):
        s = "SSN 123-45-6789 is sensitive."
        r = redact_pii(s)
        self.assertNotIn("123-45-6789", r)
        self.assertIn("[REDACTED_SSN]", r)

    def test_national_id(self):
        s = "National ID AB123456 used for verification."
        r = redact_pii(s)
        self.assertIn("[REDACTED_ID]", r)

    def test_tckn(self):
        s = "Citizen TCKN 12345678901 should be masked."
        r = redact_pii(s)
        self.assertIn("[REDACTED_TCKN]", r)

    def test_tr_iban(self):
        s = "IBAN TR12 3456 7890 1234 5678 9012 34 must be hidden."
        r = redact_pii(s)
        self.assertIn("[REDACTED_TR_IBAN]", r)

    def test_noop(self):
        s = "No PII here."
        r = redact_pii(s)
        self.assertEqual(s, r)


if __name__ == '__main__':
    unittest.main()


