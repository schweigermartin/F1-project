from f1pred.layout import bucket_name, model_artifact_key, model_card_key


def test_model_paths_match_the_shared_s3_layout() -> None:
    assert model_artifact_key("1.0.0") == "models/1.0.0/model.json"
    assert model_card_key("1.0.0") == "models/1.0.0/model_card.md"


def test_bucket_name_is_account_and_region_scoped() -> None:
    assert bucket_name("128663321407", "eu-central-1") == "f1-data-128663321407-eu-central-1"
