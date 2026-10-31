def test_unlisted_icon_is_not_served(fake_import):
    assert fake_import.path("images/icons/missing.png") is None
