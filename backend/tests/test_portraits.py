def test_unlisted_portrait_is_not_served(fake_import):
    assert fake_import.path("images/portraits/missing.png") is None
