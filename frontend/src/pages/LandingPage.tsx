import React, { FormEvent, useEffect, useState } from "react";
import { Alert, Button, Card, Input, Modal, Select, Space, Tag, Typography } from "antd";
import { ArrowRightOutlined, CodeOutlined, LaptopOutlined, TeamOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { useAppSelector } from "../app/hooks";
import { useCreateGuestRoomMutation } from "../services/api";
import { setVisitParams, trackEvent } from "../services/analytics";
import { ThemeToggleButton } from "../features/theme/ThemeToggleButton";
import styles from "./LandingPage.module.css";

const LANGUAGES = [
  { value: "nodejs", label: "Node JS" },
  { value: "python", label: "Python" },
  { value: "kotlin", label: "Kotlin" },
  { value: "java", label: "Java" },
  { value: "sql", label: "SQL" },
  { value: "plaintext", label: "Plain text" }
];

export function LandingPage() {
  const navigate = useNavigate();
  const authToken = useAppSelector((store) => store.auth.token);
  const [title, setTitle] = useState("Live-coding interview");
  const [displayName, setDisplayName] = useState("Interviewer");
  const [language, setLanguage] = useState("nodejs");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [createOpened, setCreateOpened] = useState(false);
  const [createGuestRoom, { isLoading }] = useCreateGuestRoomMutation();

  useEffect(() => {
    trackEvent("mkt_landing_view", { authenticated: Boolean(authToken) });
    setVisitParams({ entrypoint: "landing", authenticated: Boolean(authToken) });
  }, [authToken]);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    trackEvent("prod_guest_room_create_submit", {
      language,
      has_title: title.trim().length > 0,
      has_display_name: displayName.trim().length > 0
    });
    try {
      setError("");
      const room = await createGuestRoom({ title, ownerDisplayName: displayName, language }).unwrap();
      if (room.ownerToken) localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
      if (!authToken) localStorage.setItem(`guest_display_name_${room.inviteCode}`, displayName);
      trackEvent("prod_guest_room_create_success", { language, room_invite_len: room.inviteCode.length });
      navigate(`/room/${room.inviteCode}`);
    } catch {
      setError("Не удалось создать комнату. Повторите попытку.");
      trackEvent("prod_guest_room_create_failed", { language });
    }
  };

  const onJoin = (event: FormEvent) => {
    event.preventDefault();
    if (!inviteCode.trim()) return;
    const name = (displayName || "Участник").trim();
    const code = inviteCode.trim();
    trackEvent("prod_room_join_submit", {
      invite_code_len: code.length,
      has_display_name: name.length > 0
    });
    localStorage.setItem(`guest_display_name_${code}`, name);
    navigate(`/room/${code}`);
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} to="/" aria-label="InterHub — главная">
            <span className={styles.brandMark}><CodeOutlined aria-hidden="true" /></span>
            <span>
              <Typography.Text className={styles.brandName}>InterHub</Typography.Text>
              <Typography.Text className={styles.brandCaption}>realtime coding room</Typography.Text>
            </span>
          </Link>
          <div className={styles.headerActions}>
            <Tag className={styles.headerTag}>Live coding</Tag>
            <Link className={`${styles.headerButton} app-header-control`} to={authToken ? "/dashboard/rooms" : "/login"}>
              Личный кабинет
            </Link>
            <ThemeToggleButton />
          </div>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.heroCopy}>
            <Typography.Text className={styles.eyebrow}>КОМНАТА ДЛЯ ТЕХНИЧЕСКОГО ИНТЕРВЬЮ</Typography.Text>
            <Typography.Title id="landing-title" className={styles.heroTitle} level={1}>
              Запускайте интервью за 30 секунд.
            </Typography.Title>
            <Typography.Paragraph className={styles.heroDescription}>
              Общий редактор, шаги интервью и стабильная синхронизация участников без визуального шума.
            </Typography.Paragraph>

            <div className={styles.featureGrid}>
              <Card className={styles.featureCard}>
                <span className={styles.featureIcon}><TeamOutlined aria-hidden="true" /></span>
                <span>
                  <Typography.Text strong>Interviewer + Candidate</Typography.Text>
                  <Typography.Text className={styles.secondaryText}>Участники и контроль ролей</Typography.Text>
                </span>
              </Card>
              <Card className={styles.featureCard}>
                <span className={styles.featureIcon}><LaptopOutlined aria-hidden="true" /></span>
                <span>
                  <Typography.Text strong>Step-by-step flow</Typography.Text>
                  <Typography.Text className={styles.secondaryText}>Задачи и публикация шагов</Typography.Text>
                </span>
              </Card>
            </div>

            <div className={styles.codeSample} aria-label="Пример кода редактора">
              <div className={styles.codeSampleHeader}><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /><Typography.Text>solve.py</Typography.Text></div>
              <pre>{`# Python\ndef solve(nums):\n    return sum(nums)\n\n# Node JS\nfunction solve(nums) {\n  return nums.reduce((a, b) => a + b, 0);\n}`}</pre>
            </div>
          </div>

          <aside className={styles.forms} aria-label="Быстрый вход в интервью">
            <Card className={styles.formCard}>
              <Space orientation="vertical" size={4}>
                <Typography.Title level={2}>Создать комнату</Typography.Title>
                <Typography.Text className={styles.secondaryText}>Быстрый вход для интервьюера без регистрации.</Typography.Text>
              </Space>
              <Button block type="primary" size="large" icon={<ArrowRightOutlined aria-hidden="true" />} onClick={() => { setError(""); setCreateOpened(true); }}>Создать комнату</Button>
            </Card>
            <Modal open={createOpened} onCancel={() => { if (!isLoading) setCreateOpened(false); }} title="Создать комнату" centered footer={null} mask={{ closable: !isLoading }} keyboard={!isLoading} closable={!isLoading}>
              <form className={styles.form} onSubmit={onCreate}>
                <label className={styles.field}>
                  <span>Ваше имя</span>
                  <Input autoComplete="name" placeholder="Введите имя для отображения" value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} required autoFocus />
                </label>
                <label className={styles.field}>
                  <span>Название комнаты</span>
                  <Input placeholder="Введите название интервью" value={title} onChange={(event) => setTitle(event.currentTarget.value)} required />
                </label>
                <label className={styles.field}>
                  <span>Язык</span>
                  <Select aria-label="Язык" placeholder="Выберите язык решения" options={LANGUAGES} value={language} onChange={(value) => setLanguage(value)} style={{ width: "100%" }} />
                </label>
                <Space style={{ justifyContent: "flex-end", width: "100%" }}>
                <Button htmlType="button" disabled={isLoading} onClick={() => setCreateOpened(false)}>Отмена</Button>
                <Button htmlType="submit" loading={isLoading} type="primary" icon={<ArrowRightOutlined aria-hidden="true" />}>
                  Создать комнату
                </Button>
                </Space>
                {error && <Alert className={styles.formAlert} role="alert" showIcon type="error" message={error} />}
              </form>
            </Modal>

            <Card className={styles.joinCard}>
              <Typography.Title level={3}>Войти по коду</Typography.Title>
              <form className={styles.form} onSubmit={onJoin}>
                <label className={styles.field}>
                  <span>Ваше имя</span>
                  <Input autoComplete="name" placeholder="Имя, которое увидят участники" value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} required />
                </label>
                <label className={styles.field}>
                  <span>Код комнаты</span>
                  <Input placeholder="r-xxxxxxxx" value={inviteCode} onChange={(event) => setInviteCode(event.currentTarget.value)} required />
                </label>
                <Button block htmlType="submit">Подключиться</Button>
              </form>
            </Card>
          </aside>
        </section>
      </div>
    </main>
  );
}
