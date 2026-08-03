from agent.seed import seed_demo


class FakeBank:
    def __init__(self, demo_exists):
        self.demo_exists = demo_exists

    def create_customer(self, payload):
        return {"customer_id": "rand-" + payload["email"]}

    def login(self, email, password):
        if email == "demo@nano.bank":
            if not self.demo_exists:
                raise RuntimeError("no demo user")
            return "demo-tok"
        return "tok"

    def create_account(self, token, payload):
        return {"account_id": "acc"}

    def deposit(self, token, account_id, amount, description="Deposit"):
        return {"transaction_id": "t"}

    def profile(self, token):
        return {"customer_id": "demo-cid", "email": "demo@nano.bank"}


def test_adopts_demo_customer_when_present():
    out = seed_demo(FakeBank(demo_exists=True))
    assert any(c["email"] == "demo@nano.bank" for c in out["customers"])
    assert out["creds"].get("demo-cid") == ("demo@nano.bank", "Demo-Pass-2026")


def test_skips_demo_customer_when_absent():
    out = seed_demo(FakeBank(demo_exists=False))
    assert all(c["email"] != "demo@nano.bank" for c in out["customers"])
