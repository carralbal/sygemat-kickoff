import streamlit as st
import streamlit.components.v1 as components
from pathlib import Path

st.set_page_config(
    page_title="SYGEMAT — Guía de Kickoff",
    page_icon="🔶",
    layout="wide",
    initial_sidebar_state="collapsed",
)

st.markdown("""
<style>
    #MainMenu, header, footer,
    [data-testid="stHeader"],
    [data-testid="stSidebar"],
    [data-testid="collapsedControl"],
    .stDeployButton {
        display: none !important;
        visibility: hidden !important;
    }
    .stApp { overflow: hidden; }
    .block-container { padding: 0 !important; max-width: 100% !important; }
    [data-testid="stVerticalBlockBorderWrapper"] { padding: 0 !important; }
    iframe { border: none !important; width: 100% !important; }
</style>
""", unsafe_allow_html=True)

html_content = Path("kickoff.html").read_text(encoding="utf-8")
components.html(html_content, height=920, scrolling=False)
